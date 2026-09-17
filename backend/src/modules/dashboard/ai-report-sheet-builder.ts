import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';

export function sanitizeExcelCell(val: unknown): unknown {
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

export function formatTaskTypeLabel(taskType: string): string {
  switch (taskType) {
    case 'copilot':
      return 'Trợ lý Copilot';
    case 'executive_report':
      return 'Báo cáo điều hành';
    case 'audit_rule':
      return 'Kiểm toán nhóm';
    case 'vision_ocr':
      return 'Cầu nối OCR hình ảnh';
    case 'test_connection':
      return 'Kiểm tra kết nối';
    default:
      return taskType;
  }
}

export async function buildAiUsageSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from?: string,
  to?: string,
  client = prisma,
): Promise<void> {
  const sheet = workbook.addWorksheet('Chi phí AI');

  sheet.columns = [
    { header: 'Thời gian', key: 'time', width: 22 },
    { header: 'Tác vụ', key: 'taskType', width: 20 },
    { header: 'Nhà cung cấp', key: 'provider', width: 15 },
    { header: 'Mô hình', key: 'model', width: 22 },
    { header: 'Input Tokens', key: 'inputTokens', width: 14 },
    { header: 'Output Tokens', key: 'outputTokens', width: 14 },
    { header: 'Cached Tokens', key: 'cachedTokens', width: 14 },
    { header: 'Tổng Tokens', key: 'totalTokens', width: 14 },
    { header: 'Chi phí (USD)', key: 'costUsd', width: 14 },
    { header: 'Chi phí (VNĐ)', key: 'costVnd', width: 16 },
    { header: 'Trạng thái', key: 'status', width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF5E35B1' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  const where: any = { orgId };
  if (from || to) {
    where.createdAt = {};
    if (from) {
      where.createdAt.gte = new Date(`${from}T00:00:00.000Z`);
    }
    if (to) {
      where.createdAt.lte = new Date(`${to}T23:59:59.999Z`);
    }
  }

  const logs = await client.aiUsageLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  for (const log of logs) {
    const vnDate = new Date(log.createdAt.getTime() + 7 * 3600 * 1000);
    const timeStr = vnDate.toISOString().replace('T', ' ').slice(0, 19);

    const row = sheet.addRow({
      time: timeStr,
      taskType: sanitizeExcelCell(formatTaskTypeLabel(log.taskType)),
      provider: sanitizeExcelCell(log.provider),
      model: sanitizeExcelCell(log.model),
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cachedTokens: log.cachedTokens,
      totalTokens: log.totalTokens,
      costUsd: log.costUsd,
      costVnd: Number(log.costVnd),
      status: sanitizeExcelCell(log.status === 'success' ? 'Thành công' : 'Thất bại'),
    });

    row.getCell('costUsd').numFmt = '$#,##0.000000';
    row.getCell('costVnd').numFmt = '#,##0 "₫"';
    row.getCell('inputTokens').numFmt = '#,##0';
    row.getCell('outputTokens').numFmt = '#,##0';
    row.getCell('cachedTokens').numFmt = '#,##0';
    row.getCell('totalTokens').numFmt = '#,##0';
  }
}
