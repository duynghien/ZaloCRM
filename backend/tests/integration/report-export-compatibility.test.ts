import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const require = createRequire(import.meta.url);
const excelRequire = createRequire(require.resolve('exceljs'));
const JSZip = excelRequire('jszip');
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let accessToken: string;
let parse: typeof import('../../src/modules/attachments/attachment-parser.js').extractAttachmentContentInWorker;
const day = new Date('2026-09-01T00:00:00Z');

beforeAll(async () => {
  fixture = await createTestApp();
  parse = (await import('../../src/modules/attachments/attachment-parser.js')).extractAttachmentContentInWorker;
  const org = await fixture.prisma.organization.create({ data: { name: 'Workbook exports' } });
  const owner = await fixture.prisma.user.create({ data: { orgId: org.id, role: 'owner', email: `${randomUUID()}@test.invalid`, fullName: 'Export owner', passwordHash: 'unused' } });
  const { createSession } = await import('../../src/modules/auth/auth-service.js');
  accessToken = (await createSession(fixture.app, owner)).accessToken;
  const account = await fixture.prisma.zaloAccount.create({ data: { orgId: org.id, ownerUserId: owner.id } });
  const conversation = await fixture.prisma.conversation.create({ data: { orgId: org.id, zaloAccountId: account.id, externalThreadId: 'export-thread' } });
  await fixture.prisma.message.createMany({ data: ['self', 'self', 'contact'].map(senderType => ({ conversationId: conversation.id, senderType, content: 'Report data', sentAt: day })) });
  const contact = await fixture.prisma.contact.create({ data: { orgId: org.id, fullName: 'Khách hàng', createdAt: day } });
  await fixture.prisma.contact.create({ data: { orgId: org.id, fullName: 'Second contact', createdAt: day } });
  await fixture.prisma.appointment.createMany({ data: ['scheduled', 'scheduled', 'completed'].map(status => ({ orgId: org.id, contactId: contact.id, appointmentDate: day, status })) });
  const foreign = await fixture.prisma.organization.create({ data: { name: 'Foreign export decoy' } });
  await fixture.prisma.contact.create({ data: { orgId: foreign.id, fullName: 'Never exported', createdAt: day } });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it.each([
  { type: 'messages', name: 'Tin nhắn', headers: ['Ngày', 'Đã gửi', 'Đã nhận', 'Tổng'], widths: [15, 12, 12, 12], rows: [['2026-09-01', 2, 1, 3]] },
  { type: 'contacts', name: 'Liên hệ', headers: ['Ngày', 'Liên hệ mới'], widths: [15, 15], rows: [['2026-09-01', 2]] },
  { type: 'appointments', name: 'Lịch hẹn', headers: ['Trạng thái', 'Số lượng'], widths: [20, 12], rows: [['completed', 1], ['scheduled', 2]] },
])('exports $type through authenticated Fastify and preserves workbook values/layout and parser text', async ({ type, name, headers, widths, rows }) => {
  const response = await fixture.app.inject({ method: 'GET', url: `/api/v1/reports/export?type=${type}&from=2026-09-01&to=2026-09-02`, headers: { authorization: `Bearer ${accessToken}` } });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(response.headers['content-disposition']).toBe(`attachment; filename=${type}-report.xlsx`);
  expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.rawPayload as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([name]);
  const sheet = workbook.worksheets[0];
  expect(sheet.getRow(1).values).toEqual([undefined, ...headers]);
  expect(sheet.columns.map(column => column.width)).toEqual(widths);
  const actual = Array.from({ length: sheet.rowCount - 1 }, (_, index) => (sheet.getRow(index + 2).values as ExcelJS.CellValue[]).slice(1));
  expect(actual.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual(rows);
  for (let row = 2; row <= sheet.rowCount; row++) expect(sheet.getCell(row, 2).type).toBe(ExcelJS.ValueType.Number);
  const parsed = await parse({ filename: `${type}.xlsx`, buffer: response.rawPayload });
  expect(parsed).toMatchObject({ type: 'excel', sheetNames: [name] });
  expect(parsed.text).toContain(`| ${headers.join(' | ')} |`);
  for (const row of rows) expect(parsed.text).toContain(`| ${row.join(' | ')} |`);
});

it('roundtrips custom icon sets through the actual CommonJS uuid v4 conditional-format path', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('KPI');
  sheet.addRows([['Tên', 'Doanh thu'], ['Hà Nội', 1250.5], ['Hồ Chí Minh', 2750.25], ['Tổng', { formula: 'SUM(B2:B3)', result: 4000.75 }]]);
  sheet.getCell('B2').numFmt = '#,##0.00';
  sheet.getCell('A1').font = { bold: true, color: { argb: 'FF003366' } };
  const rule: ExcelJS.IconSetRuleType & { icons: Array<{ iconSet: string; iconId: number }> } = {
    type: 'iconSet', priority: 1, custom: true, iconSet: '3Triangles',
    cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }],
    icons: [0, 1, 2].map(iconId => ({ iconSet: '3Triangles', iconId })),
  };
  sheet.addConditionalFormatting({ ref: 'B2:B4', rules: [rule] });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const xml: string = await zip.file('xl/worksheets/sheet1.xml').async('string');
  // This extension serializer creates the ID by calling require('uuid').v4().
  expect(xml).toMatch(/<x14:cfRule[^>]+id="\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}"/i);
  expect(xml).toContain('iconSet="3Triangles"');
  expect(xml.match(/<x14:cfIcon /g)).toHaveLength(3);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer as unknown as Parameters<typeof restored.xlsx.load>[0]);
  const loaded = restored.getWorksheet('KPI')!;
  expect(loaded.getCell('A2').value).toBe('Hà Nội');
  expect(loaded.getCell('B2').value).toBe(1250.5);
  expect(loaded.getCell('B2').numFmt).toBe('#,##0.00');
  expect(loaded.getCell('A1').font).toMatchObject({ bold: true, color: { argb: 'FF003366' } });
  expect(loaded.getCell('B4').value).toEqual({ formula: 'SUM(B2:B3)', result: 4000.75 });
  expect((loaded as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings[0]).toMatchObject({ ref: 'B2:B4', rules: [{ type: 'iconSet', iconSet: '3Triangles' }] });
  const parsed = await parse({ filename: 'kpi.xlsx', buffer });
  expect(parsed).toMatchObject({ type: 'excel', sheetNames: ['KPI'] });
  expect(parsed.text).toContain('| Hà Nội | 1250.5 |');
  expect(parsed.text).toContain('| Tổng | 4000.75 |');
});
