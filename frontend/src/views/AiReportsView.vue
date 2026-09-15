<template>
  <div class="ai-reports-view">
    <!-- Header Banner -->
    <v-card class="mb-6 overflow-hidden chart-card" elevation="0">
      <div class="neo-banner pa-6 d-flex align-center justify-space-between flex-wrap gap-4">
        <div class="d-flex align-center gap-4">
          <div
            class="d-flex align-center justify-center neo-icon-box flex-shrink-0"
            style="width: 48px; height: 48px; background: #0068FF; border: 1.5px solid var(--border-color); border-radius: 8px; color: #FFFFFF;"
          >
            <v-icon size="28" color="white">mdi-robot-excited-outline</v-icon>
          </div>
          <div>
            <h1 class="neo-page-title mb-1" style="font-size: 1.5rem;">
              BÁO CÁO <span class="neo-title-accent">ĐIỀU HÀNH AI</span>
            </h1>
            <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
              TỔNG HỢP ĐA PHƯƠNG TIỆN (CHAT, PDF, EXCEL, ẢNH) TỪ NHÓM ZALO & PHÁT HÀNH BÁO CÁO ĐA KÊNH.
            </p>
          </div>
        </div>

        <div class="d-flex align-center gap-2">
          <v-chip color="primary" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.72rem;" prepend-icon="bolt.svg">
            {{ activeProviderLabel }} AI
          </v-chip>
          <v-chip color="success" variant="flat" rounded="pill" class="font-weight-bold neo-pill" style="border: 1.5px solid var(--border-color); font-size: 0.72rem;" prepend-icon="check.svg">
            MULTI-CHANNEL (ZALO + WEB + EMAIL)
          </v-chip>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <v-tabs v-model="activeTab" bg-color="surface" color="primary" grow density="comfortable">
        <v-tab value="generate">
          <v-icon start>bolt.svg</v-icon>
          ⚡ Tạo Báo Cáo Ngay
        </v-tab>
        <v-tab value="archive">
          <v-icon start>keyboard-alt.svg</v-icon>
          📜 Lịch Sử Báo Cáo
        </v-tab>
        <v-tab value="settings">
          <v-icon start>auto.svg</v-icon>
          ⚙️ Cấu Hình Tự Động Hóa
        </v-tab>
        <v-tab value="audit_rules">
          <v-icon start>mdi-target</v-icon>
          🎯 Quy Tắc Giám Sát
        </v-tab>
      </v-tabs>
    </v-card>

    <!-- ── TAB 1: ON-DEMAND GENERATION ──────────────────────────────────────── -->
    <div v-show="activeTab === 'generate'">
      <v-row>
        <!-- Generator Controls Panel -->
        <v-col cols="12" md="4">
          <v-card class="pa-5 mb-4" elevation="0">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">lines-leaning.svg</v-icon>
              Tùy Chọn Tổng Hợp
            </h2>

            <!-- Quick Presets -->
            <label class="text-caption font-weight-bold text-medium-emphasis mb-2 d-block">
              Mốc thời gian nhanh:
            </label>
            <div class="d-flex flex-wrap gap-2 mb-4">
              <v-chip
                v-for="preset in presets"
                :key="preset.label"
                size="small"
                :variant="selectedPreset === preset.label ? 'flat' : 'outlined'"
                :color="selectedPreset === preset.label ? 'primary' : undefined"
                @click="applyPreset(preset)"
              >
                {{ preset.label }}
              </v-chip>
            </div>

            <!-- Date Range Inputs -->
            <v-text-field
              v-model="generatorForm.fromDate"
              label="Từ ngày & giờ"
              type="datetime-local"
              density="compact"
              variant="outlined"
              class="mb-3"
            />
            <v-text-field
              v-model="generatorForm.toDate"
              label="Đến ngày & giờ"
              type="datetime-local"
              density="compact"
              variant="outlined"
              class="mb-4"
            />

            <!-- Group Selection -->
            <div class="d-flex align-center justify-space-between mb-2">
              <label class="text-caption font-weight-bold text-medium-emphasis">
                Nhóm Zalo theo dõi ({{ selectedGroupIds.length }}/{{ groups.length }}):
              </label>
              <div class="d-flex gap-1">
                <v-btn variant="text" size="x-small" color="primary" @click="selectAllGroups">Tất cả</v-btn>
                <v-btn variant="text" size="x-small" color="secondary" @click="deselectAllGroups">Bỏ chọn</v-btn>
              </div>
            </div>

            <v-select
              v-model="selectedGroupIds"
              :items="groupOptions"
              item-title="label"
              item-value="key"
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
              placeholder="Chọn nhóm Zalo cần tóm tắt"
              hint="Chọn tối đa 20 nguồn. Cùng một nhóm trên hai tài khoản là hai nguồn riêng." persistent-hint
              class="mb-4"
            />

            <v-divider class="my-3" />

            <!-- Dispatch Options -->
            <h3 class="text-caption font-weight-bold text-medium-emphasis mb-2">
              Kênh phát hành tức thì:
            </h3>

            <v-checkbox
              v-model="generatorForm.sendZalo"
              density="compact"
              hide-details
              color="primary"
              label="Gửi tin nhắn về Zalo cá nhân"
            />
            <div v-if="generatorForm.sendZalo" class="pl-7 mb-3">
              <v-select v-model="generatorForm.senderAccountId" :items="senderOptions" item-title="label" item-value="id"
                label="Tài khoản Zalo gửi báo cáo" placeholder="Chọn tài khoản gửi" density="compact" variant="outlined"
                hint="Chọn rõ tài khoản gửi; tài khoản này có thể khác nguồn tổng hợp." persistent-hint class="mb-3" />
              <v-radio-group v-model="generatorForm.zaloDestinationType" density="compact" hide-details>
                <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
                <v-radio label="Nhập Zalo UID hoặc Số điện thoại" value="uid" />
              </v-radio-group>
              <v-text-field
                v-if="generatorForm.zaloDestinationType === 'uid'"
                v-model="generatorForm.zaloTargetUid"
                placeholder="Nhập Zalo UID hoặc Số điện thoại người nhận"
                density="compact"
                variant="outlined"
                class="mt-2"
                hint="Nhập số định danh Zalo UID (ví dụ: 1624669733262510385) hoặc Số điện thoại người nhận (hệ thống sẽ tự động tra cứu danh bạ CRM hoặc tìm kiếm qua Zalo API)."
                persistent-hint
              />
            </div>

            <v-checkbox
              v-model="generatorForm.sendEmail"
              density="compact"
              hide-details
              color="primary"
              label="Gửi bản tin qua Email HTML"
            />
            <div v-if="generatorForm.sendEmail" class="pl-7 mb-3">
              <v-text-field
                v-model="generatorForm.emailRecipient"
                placeholder="Nhập địa chỉ email người nhận"
                density="compact"
                variant="outlined"
                class="mt-2"
                hide-details
              />
            </div>

            <!-- Submit Button -->
            <v-btn
              block
              color="primary"
              size="large"
              class="mt-4 font-weight-bold"
              rounded="lg"
              style="border: 1.5px solid var(--border-color);"
              elevation="0"
              :loading="isGenerating"
              :disabled="isGenerating || selectedGroupIds.length === 0 || selectedGroupIds.length > 20 || (generatorForm.sendZalo && !generatorForm.senderAccountId)"
              @click="handleGenerateReport"
            >
              <v-icon start>mdi-lightning-bolt</v-icon>
              {{ isGenerating ? `Đang tổng hợp (${generatingTimer}s)...` : '⚡ Tạo Báo Cáo Ngay' }}
            </v-btn>
          </v-card>
        </v-col>

        <!-- Markdown Viewer Panel -->
        <v-col cols="12" md="8">
          <v-card class="pa-6 min-height-card" elevation="0">
            <!-- Empty State -->
            <div v-if="!currentReport && !isGenerating" class="d-flex flex-column align-center justify-center py-16 text-center">
              <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-text-box-search-outline</v-icon>
              <h3 class="text-h6 font-weight-bold text-medium-emphasis mb-2">Chưa có báo cáo nào được tạo</h3>
              <p class="text-body-2 text-disabled" style="max-width: 420px;">
                Chọn khoảng thời gian và danh sách nhóm Zalo ở bảng bên trái, sau đó bấm <strong>"⚡ Tạo Báo Cáo Ngay"</strong> để AI trích xuất và tổng hợp toàn bộ nội dung.
              </p>
            </div>

            <!-- Generating State -->
            <div v-if="isGenerating" class="d-flex flex-column align-center justify-center py-16 text-center">
              <v-progress-circular indeterminate color="primary" size="64" width="6" class="mb-6" />
              <h3 class="text-h6 font-weight-bold mb-2">AI đang đọc & phân tích các nhóm Zalo...</h3>
              <p class="text-body-2 text-medium-emphasis mb-0">
                Đang quét tin nhắn văn bản, trích xuất bảng tính Excel, tài liệu PDF và tổng hợp báo cáo điều hành chuẩn 5 phần.
              </p>
              <v-chip class="mt-4 font-weight-bold" color="primary" variant="tonal">
                Thời gian xử lý: {{ generatingTimer }}s
              </v-chip>
              <v-btn class="mt-4" variant="outlined" color="error" @click="cancelGeneratingJob">Hủy tạo báo cáo</v-btn>
            </div>

            <!-- Report Display -->
            <div v-if="currentReport && !isGenerating">
              <!-- Report Action Bar -->
              <div class="d-flex align-center justify-space-between flex-wrap gap-2 pb-4 mb-4 border-b">
                <div>
                  <h2 class="text-h6 font-weight-bold mb-1">{{ currentReport.title }}</h2>
                  <div class="d-flex align-center gap-2 text-caption text-medium-emphasis">
                    <span>🕒 Tạo lúc: {{ formatDateTime(currentReport.createdAt) }}</span>
                    <span>•</span>
                    <v-chip size="x-small" color="primary" variant="flat">{{ currentReport.reportType }}</v-chip>
                    <v-chip v-if="currentReport.metadata?.isFallback" size="x-small" color="warning" variant="flat" class="font-weight-bold" prepend-icon="mdi-alert">
                      ⚠️ Dự phòng: {{ currentReport.metadata.actualModel }}
                    </v-chip>
                    <v-chip v-if="currentReport.sentZalo" size="x-small" color="success" prepend-icon="mdi-check">Đã gửi Zalo</v-chip>
                    <v-chip v-if="currentReport.sentEmail" size="x-small" color="info" prepend-icon="mdi-check">Đã gửi Email</v-chip>
                  </div>
                </div>

                <div class="d-flex align-center gap-2">
                  <v-btn variant="outlined" size="small" prepend-icon="mdi-content-copy" @click="copyMarkdown">
                    Sao chép
                  </v-btn>
                  <v-btn variant="outlined" size="small" prepend-icon="mdi-printer" @click="printReport">
                    In / PDF
                  </v-btn>
                  <v-btn color="primary" size="small" prepend-icon="mdi-send-outline" :disabled="!reportCanResend(currentReport)" @click="openResendDialog(currentReport)">
                    Gửi lại
                  </v-btn>
                </div>
              </div>

              <v-alert v-if="!reportCanResend(currentReport)" type="warning" variant="tonal" class="mb-4">
                Báo cáo cũ chưa xác minh tài khoản nguồn. Chỉ quản trị viên được xem; không thể gửi lại.
                Hãy chọn rõ nhóm và tài khoản nguồn để tạo báo cáo mới.
              </v-alert>

              <v-alert
                v-if="deliveryError"
                type="warning"
                variant="tonal"
                class="mb-4"
                closable
                @click:close="deliveryError = ''"
              >
                <div class="d-flex align-center justify-space-between flex-wrap gap-2">
                  <span>⚠️ Báo cáo đã tạo thành công nhưng gặp sự cố khi gửi: {{ deliveryError }}</span>
                  <v-btn
                    color="warning"
                    variant="flat"
                    size="small"
                    class="ml-3"
                    @click="openResendDialog(currentReport)"
                  >
                    Gửi lại ngay
                  </v-btn>
                </div>
              </v-alert>

              <!-- Rendered Markdown Body -->
              <div class="markdown-body-rendered pa-2" v-html="renderedMarkdown"></div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- ── TAB 2: REPORT ARCHIVE ────────────────────────────────────────────── -->
    <div v-show="activeTab === 'archive'">
      <v-card class="pa-5" elevation="0">
        <div class="d-flex align-center justify-space-between flex-wrap gap-4 mb-4">
          <div class="d-flex align-center gap-2">
            <v-chip
              v-for="filter in typeFilters"
              :key="filter.value"
              :variant="archiveTypeFilter === filter.value ? 'flat' : 'outlined'"
              :color="archiveTypeFilter === filter.value ? 'primary' : undefined"
              @click="setArchiveFilter(filter.value)"
            >
              {{ filter.label }}
            </v-chip>
          </div>

          <v-btn variant="text" prepend-icon="mdi-refresh" @click="loadReports">
            Làm mới
          </v-btn>
        </div>

        <v-table hover class="rounded-lg">
          <thead>
            <tr>
              <th class="font-weight-bold">Thời gian tạo</th>
              <th class="font-weight-bold">Tiêu đề báo cáo</th>
              <th class="font-weight-bold">Loại</th>
              <th class="font-weight-bold">Khoảng thời gian</th>
              <th class="font-weight-bold">Kênh gửi</th>
              <th class="font-weight-bold text-right">Hành động</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rep in reports" :key="rep.id">
              <td class="text-caption">{{ formatDateTime(rep.createdAt) }}</td>
              <td class="font-weight-medium">
                {{ rep.title }}
                <v-chip v-if="!reportCanResend(rep)" size="small" color="warning" class="ml-2">Nguồn chưa xác minh</v-chip>
                <v-chip v-if="rep.metadata?.isFallback" size="x-small" color="warning" variant="flat" class="ml-2 font-weight-bold">
                  ⚠️ Dự phòng: {{ rep.metadata.actualModel || 'Fallback' }}
                </v-chip>
              </td>
              <td>
                <v-chip size="small" :color="getReportTypeColor(rep.reportType)">
                  {{ rep.reportType }}
                </v-chip>
              </td>
              <td class="text-caption text-medium-emphasis">
                {{ formatDate(rep.periodFrom) }} - {{ formatDate(rep.periodTo) }}
              </td>
              <td>
                <div class="d-flex gap-1">
                  <v-chip size="x-small" :color="rep.sentZalo ? 'success' : 'default'">
                    Zalo: {{ rep.sentZalo ? 'Đã gửi' : 'Chưa' }}
                  </v-chip>
                  <v-chip size="x-small" :color="rep.sentEmail ? 'info' : 'default'">
                    Email: {{ rep.sentEmail ? 'Đã gửi' : 'Chưa' }}
                  </v-chip>
                </div>
              </td>
              <td class="text-right">
                <v-btn icon="mdi-eye-outline" size="small" variant="text" color="primary" @click="viewReportDetail(rep)" />
                <v-btn icon="mdi-send-outline" size="small" variant="text" color="secondary" :disabled="!reportCanResend(rep)" aria-label="Gửi lại báo cáo" @click="openResendDialog(rep)" />
              </td>
            </tr>
            <tr v-if="reports.length === 0">
              <td colspan="6" class="text-center py-8 text-medium-emphasis">
                Chưa có báo cáo nào được lưu trữ.
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </div>

    <!-- ── TAB 3: AUTOMATION & SETTINGS ────────────────────────────────────── -->
    <div v-if="activeTab === 'settings'">
      <v-row>
        <!-- AI Provider & Fallback Configuration -->
        <v-col cols="12">
          <AiProviderSettingsCard
            v-model="aiProviderSettings"
            :is-saving="isSavingAi"
            @save="handleSaveAiSettings"
          />
        </v-col>

        <!-- Cron Schedule & Channels -->
        <v-col cols="12" md="6">
          <v-card class="pa-5 mb-4" elevation="0">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-clock-time-four-outline</v-icon>
              Lịch Tự Động Hóa (Cron Schedules)
            </h2>

            <v-switch
              v-model="automationSettings.dailyEnabled"
              color="primary"
              label="Báo cáo hàng ngày lúc 18:00 (Daily at 18:00)"
              hint="Tự động tổng hợp hoạt động trong ngày và phát hành lúc 18:00"
              persistent-hint
              class="mb-3"
            />

            <v-switch
              v-model="automationSettings.weeklyEnabled"
              color="primary"
              label="Báo cáo tổng kết tuần (Thứ 7 lúc 17:00)"
              hint="Tự động tổng hợp dữ liệu 7 ngày qua vào 17:00 chiều Thứ 7"
              persistent-hint
              class="mb-4"
            />

            <v-divider class="my-4" />

            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-cellphone-message</v-icon>
              Cấu Hình Kênh Zalo
            </h2>

            <v-switch
              v-model="automationSettings.sendZalo"
              color="primary"
              label="Tự động gửi báo cáo về Zalo"
              class="mb-2"
            />

            <div v-if="automationSettings.sendZalo" class="pl-2 mb-4">
              <v-select v-model="automationSettings.senderAccountId" :items="senderOptions" item-title="label" item-value="id"
                label="Tài khoản Zalo gửi báo cáo" placeholder="Chọn tài khoản gửi" density="compact" variant="outlined"
                hint="Chọn rõ tài khoản gửi; tài khoản này có thể khác nguồn tổng hợp." persistent-hint class="mb-3" />
              <v-radio-group v-model="automationSettings.zaloDestinationType" density="compact">
                <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
                <v-radio label="Nhập Zalo UID hoặc Số điện thoại" value="uid" />
              </v-radio-group>
              <v-text-field
                v-if="automationSettings.zaloDestinationType === 'uid'"
                v-model="automationSettings.zaloTargetUid"
                label="Zalo UID / Số điện thoại đích"
                placeholder="Nhập Zalo UID hoặc Số điện thoại người nhận"
                density="compact"
                variant="outlined"
                hint="Nhập số định danh Zalo UID hoặc Số điện thoại người nhận"
                persistent-hint
              />
            </div>
          </v-card>
        </v-col>

        <!-- SMTP Settings -->
        <v-col cols="12" md="6">
          <v-card class="pa-5 mb-4" elevation="0">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">mailbox.svg</v-icon>
              Cấu Hình Email SMTP
            </h2>

            <v-switch
              v-model="automationSettings.sendEmail"
              color="primary"
              label="Tự động gửi bản tin qua Email"
              class="mb-3"
            />

            <v-row dense>
              <v-col cols="8">
                <v-text-field
                  v-model="smtpSettings.host"
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="4">
                <v-text-field
                  v-model="smtpSettings.port"
                  label="Port"
                  type="number"
                  placeholder="587"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
            </v-row>

            <v-text-field
              v-model="smtpSettings.user"
              label="SMTP Username / Email"
              placeholder="your-email@gmail.com"
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-text-field
              v-model="smtpSettings.pass"
              label="SMTP Password / App Password"
              type="password"
              :placeholder="smtpSettings.passSet ? '(Mật khẩu đã được lưu - nhập lại nếu muốn đổi)' : 'Nhập mật khẩu SMTP'"
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-text-field
              v-model="smtpSettings.from"
              label="From Sender"
              placeholder='"ZaloCRM AI Digest" <no-reply@company.com>'
              density="compact"
              variant="outlined"
              class="mb-2"
            />

            <v-combobox
              v-model="automationSettings.emailRecipients"
              label="Danh sách email nhận báo cáo"
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
              placeholder="Nhập email và ấn Enter"
            />

            <v-btn
              color="primary"
              block
              size="large"
              rounded="lg"
              style="border: 1.5px solid var(--border-color);"
              elevation="0"
              class="mt-4 font-weight-bold"
              :loading="isSavingSettings"
              @click="saveAllSettings"
            >
              <v-icon start>mdi-content-save</v-icon>
              Lưu Cấu Hình Tự Động Hóa
            </v-btn>
          </v-card>
        </v-col>

        <!-- Monitored Groups Table -->
        <v-col cols="12">
          <v-card class="pa-5 chart-card" elevation="0">
            <h2 class="text-subtitle-1 font-weight-bold mb-4 d-flex align-center">
              <v-icon color="primary" class="mr-2">users.svg</v-icon>
              Cấu Hình Trọng Tâm Từng Nhóm Zalo ({{ groups.length }} nhóm)
            </h2>

            <v-table hover>
              <thead>
                <tr>
                  <th>Tên nhóm</th>
                  <th>Trạng thái theo dõi</th>
                  <th>Ghi chú trọng tâm cho AI</th>
                  <th>Từ khóa làm nổi bật</th>
                  <th class="text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in groups" :key="groupPairKey(g)">
                  <td class="font-weight-medium">{{ g.groupName }}<div class="text-caption text-medium-emphasis">{{ groupAccountLabel(g) }}</div></td>
                  <td>
                    <v-switch
                      v-model="g.isEnabled"
                      color="primary"
                      density="compact"
                      hide-details
                      @update:model-value="saveGroupConfig(g)"
                    />
                  </td>
                  <td>
                    <v-text-field
                      v-model="g.customPrompt"
                      placeholder="Ví dụ: Tập trung vào báo cáo doanh số & tiến độ xử lý khách VIP"
                      density="compact"
                      variant="plain"
                      hide-details
                      @blur="saveGroupConfig(g)"
                    />
                  </td>
                  <td>
                    <span v-if="g.focusKeywords?.length">{{ g.focusKeywords.join(', ') }}</span>
                    <span v-else class="text-disabled text-caption">Chưa thiết lập</span>
                  </td>
                  <td class="text-right">
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      prepend-icon="mdi-pencil-outline"
                      @click="openEditGroupDialog(g)"
                    >
                      Sửa
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- ── TAB 4: AUDIT RULES MANAGER ────────────────────────────────────── -->
    <div v-if="activeTab === 'audit_rules'">
      <AiAuditRulesCard
        :groups="groups"
        :accounts="senderAccounts"
        @navigate-archive="activeTab = 'archive'"
      />
    </div>

    <!-- ── DIALOG: EDIT GROUP CONFIG ──────────────────────────────────────── -->
    <v-dialog v-model="editGroupDialog" max-width="560">
      <v-card v-if="editingGroup" class="pa-5 chart-card" elevation="0">
        <h3 class="text-h6 font-weight-bold mb-4">Cấu Hình Nhóm: {{ editingGroup.groupName }}</h3>
        <p class="text-body-2 mb-4">{{ groupAccountLabel(editingGroup) }}</p>

        <v-text-field
          v-model="editingGroup.groupName"
          label="Tên nhóm hiển thị"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <v-textarea
          v-model="editingGroup.customPrompt"
          label="Yêu cầu trọng tâm cho AI (Custom Prompt)"
          placeholder="Nhập hướng dẫn riêng cho AI khi tóm tắt nhóm này..."
          rows="3"
          density="compact"
          variant="outlined"
          rounded="lg"
          class="mb-3"
        />

        <v-combobox
          v-model="editingGroup.focusKeywords"
          label="Từ khóa ưu tiên (Focus Keywords)"
          multiple
          chips
          closable-chips
          density="compact"
          variant="outlined"
          rounded="lg"
          placeholder="Nhập từ khóa và ấn Enter (VD: Doanh số, Bug, Khách VIP)"
          class="mb-4"
        />

        <div class="d-flex justify-end gap-2">
          <v-btn variant="text" rounded="lg" @click="editGroupDialog = false">Hủy</v-btn>
          <v-btn color="primary" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);" @click="handleSaveEditingGroup">Lưu thay đổi</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- ── DIALOG: RESEND REPORT ─────────────────────────────────────────── -->
    <v-dialog v-model="resendDialog" max-width="500">
      <v-card v-if="selectedReportForResend" class="pa-5 chart-card" elevation="0">
        <h3 class="text-h6 font-weight-bold mb-3">Gửi Lại Báo Cáo</h3>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ selectedReportForResend.title }}</p>

        <v-checkbox
          v-model="resendForm.sendZalo"
          label="Gửi qua Zalo cá nhân"
          density="compact"
          color="primary"
          hide-details
        />
        <div v-if="resendForm.sendZalo" class="pl-7 mb-3">
              <v-select v-model="resendForm.senderAccountId" :items="senderOptions" item-title="label" item-value="id"
                label="Tài khoản Zalo gửi báo cáo" placeholder="Chọn tài khoản gửi" density="compact" variant="outlined"
                hint="Chọn rõ tài khoản gửi; tài khoản này có thể khác nguồn tổng hợp." persistent-hint class="mb-3" />
              <v-radio-group v-model="resendForm.zaloDestinationType" density="compact" hide-details>
            <v-radio label="Cloud của tôi (Self-conversation)" value="self" />
            <v-radio label="Nhập Zalo UID hoặc Số điện thoại" value="uid" />
          </v-radio-group>
          <v-text-field
            v-if="resendForm.zaloDestinationType === 'uid'"
            v-model="resendForm.zaloTargetUid"
            placeholder="Nhập Zalo UID hoặc Số điện thoại người nhận"
            density="compact"
            variant="outlined"
            class="mt-2"
            hint="Nhập số định danh Zalo UID hoặc Số điện thoại người nhận"
            persistent-hint
          />
        </div>

        <v-checkbox
          v-model="resendForm.sendEmail"
          label="Gửi qua Email HTML"
          density="compact"
          color="primary"
          hide-details
        />
        <div v-if="resendForm.sendEmail" class="pl-7 mb-3">
          <v-text-field
            v-model="resendForm.emailRecipient"
            placeholder="Địa chỉ Email nhận"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
        </div>

        <v-alert v-if="deliveryError" type="warning" variant="tonal" class="mt-3">{{ deliveryError }}</v-alert>
        <v-btn v-if="resendRequiresReconciliation" :disabled="isResending" variant="outlined" color="warning"
          class="mt-3" block style="white-space: normal; height: auto; min-height: 44px" @click="prepareReconciledResend">
          Đã đối soát — tạo lượt gửi mới
        </v-btn>
        <div class="d-flex justify-end gap-2 mt-4">
          <v-btn variant="text" @click="resendDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="isResending" :disabled="isResending || (resendForm.sendZalo && !resendForm.senderAccountId) || (!resendForm.sendZalo && !resendForm.sendEmail)" @click="handleResendSubmit">Gửi ngay</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-alert v-if="deliveryError" type="warning" variant="tonal" class="mt-4" closable @click:close="deliveryError = ''">
      {{ deliveryError }}
    </v-alert>
    <!-- Snackbar Notification -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import AiProviderSettingsCard from '@/components/ai-reports/AiProviderSettingsCard.vue';
import AiAuditRulesCard from '@/components/ai-reports/AiAuditRulesCard.vue';
import { groupPairKey, groupAccountLabel, reportCanResend, resendAttemptKey, completeResendAttempt, resendNeedsReconciliation, markResendAttemptUncertain, reconcileResendAttempt, createDefaultAiProviderSettings, DEFAULT_AI_PROVIDERS } from '@/api/ai-report-view-helpers';
import {
  aiReportApi,
  type GroupItem,
  type GeneratedReportItem,
  type AutomationSettings,
  type SmtpSettings,
  type ResendReportPayload,
  type AiProviderSettings,
} from '@/api/ai-report-api';

const activeTab = ref('generate');
const deliveryError = ref('');
const senderAccounts = ref<Awaited<ReturnType<typeof aiReportApi.getSenderAccounts>>>([]);
const senderOptions = computed(() => senderAccounts.value.map(account => ({ id: account.id,
  label: `${account.displayName || 'Tài khoản Zalo'} (${account.zaloUid || account.id}) — ${account.status === 'connected' ? 'Đã kết nối' : 'Chưa kết nối'}`,
})));

// AI Provider settings state
const aiProviderSettings = ref<AiProviderSettings>(createDefaultAiProviderSettings());
const isSavingAi = ref(false);

const activeProviderLabel = computed(() => {
  const p = aiProviderSettings.value.primaryProvider || 'gemini';
  return p.toUpperCase();
});

// Generator state
const groups = ref<GroupItem[]>([]);
const selectedGroupIds = ref<string[]>([]);
const groupOptions = computed(() => groups.value.filter(group => group.zaloAccount).map(group => ({
  key: groupPairKey(group), label: `${group.groupName} — ${groupAccountLabel(group)}`,
})));
const isGenerating = ref(false);
const generatingTimer = ref(0);
const activeJobId = ref<string | null>(null);
let timerInterval: any = null;
const pendingJobStorageKey = 'zalocrm.ai-report.pending-job';

const currentReport = ref<GeneratedReportItem | null>(null);

const generatorForm = ref({
  fromDate: '',
  toDate: '',
  sendZalo: true,
  senderAccountId: '',
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
  sendEmail: false,
  emailRecipient: '',
});

// Presets
const selectedPreset = ref('Hôm nay');
const presets = [
  { label: 'Hôm nay', days: 0 },
  { label: 'Hôm qua', days: 1 },
  { label: '7 ngày qua', days: 7 },
  { label: 'Tuần này', days: 'this_week' },
];

function applyPreset(preset: any) {
  selectedPreset.value = preset.label;
  const now = new Date();

  if (preset.days === 0) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  } else if (preset.days === 1) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(end);
  } else if (preset.days === 7) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  } else if (preset.days === 'this_week') {
    const start = new Date(now);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    generatorForm.value.fromDate = formatToLocalDatetimeInput(start);
    generatorForm.value.toDate = formatToLocalDatetimeInput(now);
  }
}

function formatToLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function selectAllGroups() {
  selectedGroupIds.value = groups.value.filter(g => g.zaloAccount).map(groupPairKey);
}

function deselectAllGroups() {
  selectedGroupIds.value = [];
}

// Rendered Markdown
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const renderedMarkdown = computed(() => {
  if (!currentReport.value?.summaryContent) return '';
  const parsed = marked.parse(currentReport.value.summaryContent);
  return DOMPurify.sanitize(typeof parsed === 'string' ? parsed : '', {
    FORBID_TAGS: ['style', 'form', 'input'],
  });
});

// Report Archive State
const reports = ref<GeneratedReportItem[]>([]);
const archiveTypeFilter = ref('all');
const typeFilters = [
  { label: 'Tất cả', value: 'all' },
  { label: 'Hàng ngày', value: 'daily' },
  { label: 'Hàng tuần', value: 'weekly' },
  { label: 'Tức thì (On-Demand)', value: 'on_demand' },
];

function setArchiveFilter(val: string) {
  archiveTypeFilter.value = val;
  loadReports();
}

// Settings State
const automationSettings = ref<AutomationSettings>({
  dailyEnabled: true,
  weeklyEnabled: true,
  sendZalo: true,
  senderAccountId: '',
  zaloDestinationType: 'self',
  sendEmail: false,
  emailRecipients: [],
});

const smtpSettings = ref<SmtpSettings>({
  host: '',
  port: 587,
  user: '',
  pass: '',
  passSet: false,
  from: '',
});

const isSavingSettings = ref(false);

// Edit Group Dialog
const editGroupDialog = ref(false);
const editingGroup = ref<GroupItem | null>(null);

function openEditGroupDialog(group: GroupItem) {
  editingGroup.value = JSON.parse(JSON.stringify(group));
  editGroupDialog.value = true;
}

async function handleSaveEditingGroup() {
  if (!editingGroup.value) return;
  if (!await saveGroupConfig(editingGroup.value)) return;
  const idx = groups.value.findIndex((g) => groupPairKey(g) === groupPairKey(editingGroup.value!));
  if (idx !== -1) {
    groups.value[idx] = editingGroup.value;
  }
  editGroupDialog.value = false;
  showSnackbar('Đã lưu cấu hình nhóm thành công', 'success');
}

async function saveGroupConfig(g: GroupItem) {
  if (!g.zaloAccount) { showSnackbar('Tài khoản nguồn không còn khả dụng', 'error'); return false; }
  try {
    await aiReportApi.updateConfig(g.threadId, {
      zalo_account_id: g.zaloAccount.id,
      group_name: g.groupName,
      is_enabled: g.isEnabled,
      custom_prompt: g.customPrompt,
      focus_keywords: g.focusKeywords,
    });
    return true;
  } catch (err) {
    showSnackbar('Lỗi khi lưu cấu hình nhóm', 'error');
    return false;
  }
}

// Resend Dialog
const resendDialog = ref(false);
const selectedReportForResend = ref<GeneratedReportItem | null>(null);
const isResending = ref(false);
const resendRequiresReconciliation = ref(false);
const resendForm = ref({
  sendZalo: true,
  senderAccountId: '',
  zaloDestinationType: 'self' as 'self' | 'uid',
  zaloTargetUid: '',
  sendEmail: false,
  emailRecipient: '',
});

function openResendDialog(rep: GeneratedReportItem) {
  if (!reportCanResend(rep)) { showSnackbar('Không thể gửi lại báo cáo có nguồn chưa xác minh', 'warning'); return; }
  selectedReportForResend.value = rep;
  resendRequiresReconciliation.value = resendNeedsReconciliation(rep.id);
  deliveryError.value = resendRequiresReconciliation.value
    ? 'Lượt gửi trước có thể đã gửi một phần hoặc chưa rõ kết quả. Thử lại giữ nguyên lượt gửi; hãy đối soát người nhận trước khi tạo lượt mới.' : '';
  resendForm.value.sendZalo = rep.sentZalo;
  resendForm.value.sendEmail = rep.sentEmail;
  resendDialog.value = true;
}

function prepareReconciledResend() {
  const report = selectedReportForResend.value;
  if (!report || isResending.value || !reconcileResendAttempt(report.id)) return;
  resendRequiresReconciliation.value = false;
  deliveryError.value = '';
  showSnackbar('Đã chuẩn bị lượt gửi mới. Kiểm tra lựa chọn rồi bấm Gửi ngay.', 'info');
}

async function handleResendSubmit() {
  const report = selectedReportForResend.value;
  if (!report || !reportCanResend(report) || isResending.value) return;
  if (resendForm.value.sendZalo && !resendForm.value.senderAccountId) {
    showSnackbar('Vui lòng chọn tài khoản Zalo gửi báo cáo', 'warning'); return;
  }
  isResending.value = true;
  try {
    const payload: ResendReportPayload = {
      send_zalo: resendForm.value.sendZalo,
      zalo_account_id: resendForm.value.sendZalo ? resendForm.value.senderAccountId : undefined,
      send_email: resendForm.value.sendEmail,
      zalo_destination_type: resendForm.value.zaloDestinationType,
      zalo_target_uid: resendForm.value.sendZalo && resendForm.value.zaloDestinationType === 'uid'
        ? resendForm.value.zaloTargetUid.trim() || undefined : undefined,
      email_recipients: resendForm.value.emailRecipient ? [resendForm.value.emailRecipient] : undefined,
    };
    const key = await resendAttemptKey(report.id, payload);
    markResendAttemptUncertain(report.id);
    const result = await aiReportApi.resendReport(report.id, payload, key);
    if (!result.success || result.zalo?.deliveryUncertain || result.zalo?.success === false || result.email?.success === false) {
      deliveryError.value = `Báo cáo có thể đã gửi một phần hoặc chưa xác nhận kết quả. ${result.zalo?.error || result.email?.error || ''} Hãy kiểm tra người nhận trước khi tạo lượt gửi mới.`;
      return;
    }
    completeResendAttempt(report.id);
    resendRequiresReconciliation.value = false;
    deliveryError.value = '';
    resendDialog.value = false;
    showSnackbar('Đã gửi lại báo cáo thành công!', 'success');
    loadReports();
  } catch (err: any) {
    deliveryError.value = `${err?.response?.data?.error || err?.message || 'Chưa xác nhận được kết quả gửi lại.'} Khi thử lại cùng lựa chọn, hệ thống kiểm tra lượt gửi hiện tại để tránh gửi trùng.`;
  } finally {
    resendRequiresReconciliation.value = resendNeedsReconciliation(report.id);
    isResending.value = false;
  }
}

// Snackbar
const snackbar = ref({
  show: false,
  text: '',
  color: 'success',
});

function showSnackbar(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

// Actions
async function handleGenerateReport() {
  if (isGenerating.value) return;
  const chosen = groups.value.filter(group => selectedGroupIds.value.includes(groupPairKey(group)));
  if (!chosen.length || chosen.length > 20 || chosen.length !== selectedGroupIds.value.length || chosen.some(group => !group.zaloAccount)) {
    showSnackbar('Chọn từ 1 đến 20 nhóm cùng tài khoản nguồn hợp lệ', 'warning'); return;
  }
  if (generatorForm.value.sendZalo && !generatorForm.value.senderAccountId) {
    showSnackbar('Vui lòng chọn tài khoản Zalo gửi báo cáo', 'warning'); return;
  }
  if (!generatorForm.value.fromDate || !generatorForm.value.toDate) {
    showSnackbar('Vui lòng chọn đầy đủ thời gian bắt đầu và kết thúc', 'warning');
    return;
  }

  isGenerating.value = true;
  deliveryError.value = '';
  generatingTimer.value = 0;
  timerInterval = setInterval(() => {
    generatingTimer.value++;
  }, 1000);

  try {
    const res = await aiReportApi.generateReport({
      from_date: new Date(generatorForm.value.fromDate).toISOString(),
      to_date: new Date(generatorForm.value.toDate).toISOString(),
      group_targets: chosen.map(group => ({ zalo_account_id: group.zaloAccount!.id, group_thread_id: group.threadId })),
      zalo_account_id: generatorForm.value.sendZalo ? generatorForm.value.senderAccountId : undefined,
      send_zalo: generatorForm.value.sendZalo,
      send_email: generatorForm.value.sendEmail,
      zalo_destination_type: generatorForm.value.zaloDestinationType,
      zalo_target_uid: generatorForm.value.sendZalo && generatorForm.value.zaloDestinationType === 'uid'
        ? generatorForm.value.zaloTargetUid.trim() || undefined : undefined,
      email_recipients: generatorForm.value.emailRecipient ? [generatorForm.value.emailRecipient] : undefined,
    }, crypto.randomUUID());
    activeJobId.value = res.jobId;
    sessionStorage.setItem(pendingJobStorageKey, res.jobId);
    await waitForReportJob(res.jobId);
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Lỗi trong quá trình tạo báo cáo AI', 'error');
  } finally {
    isGenerating.value = false;
    activeJobId.value = null;
    if (timerInterval) clearInterval(timerInterval);
  }
}

async function waitForReportJob(jobId: string) {
  let delayMs = 1_000;
  while (activeJobId.value === jobId) {
    const { job } = await aiReportApi.getJob(jobId);
    if (job.status === 'succeeded' && job.resultReportId) {
      const { report } = await aiReportApi.getReport(job.resultReportId);
      currentReport.value = report;
      sessionStorage.removeItem(pendingJobStorageKey);
      showSnackbar('Đã tạo báo cáo AI thành công!', 'success');
      loadReports();
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      sessionStorage.removeItem(pendingJobStorageKey);
      if (job.resultReportId) {
        try {
          const { report } = await aiReportApi.getReport(job.resultReportId);
          currentReport.value = report;
          activeTab.value = 'generate';
          loadReports();
        } catch (getReportErr) {
          loggerError('Get generated report after delivery failure', getReportErr);
        }
      }
      deliveryError.value = job.errorMessage || (job.status === 'cancelled' ? 'Đã hủy tạo báo cáo. Phần đã gửi trước khi hủy không thể thu hồi.' : 'Tạo báo cáo thất bại');
      showSnackbar(job.resultReportId ? 'Báo cáo đã tổng hợp thành công nhưng chưa thể gửi qua kênh phát hành. Bạn có thể xem nội dung và bấm Gửi lại.' : deliveryError.value, job.resultReportId ? 'warning' : 'error');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 8_000);
  }
}

async function cancelGeneratingJob() {
  if (!activeJobId.value) return;
  try {
    await aiReportApi.cancelJob(activeJobId.value);
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Không thể hủy báo cáo', 'error');
  }
}

function copyMarkdown() {
  if (!currentReport.value?.summaryContent) return;
  navigator.clipboard.writeText(currentReport.value.summaryContent);
  showSnackbar('Đã sao chép nội dung Markdown vào clipboard!', 'info');
}

function printReport() {
  window.print();
}

async function viewReportDetail(rep: GeneratedReportItem) {
  currentReport.value = null;
  try {
    const { report } = await aiReportApi.getReport(rep.id);
    currentReport.value = report;
    activeTab.value = 'generate';
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Không thể xem báo cáo hoặc quyền truy cập đã thay đổi', 'error');
  }
}

function getReportTypeColor(type: string) {
  if (type === 'daily') return 'primary';
  if (type === 'weekly') return 'purple';
  return 'teal';
}

function formatDateTime(str: string) {
  if (!str) return '';
  return new Date(str).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(str: string) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });
}

// Data loaders
async function loadGroups() {
  try {
    const res = await aiReportApi.getGroups();
    groups.value = res.groups;
    selectedGroupIds.value = res.groups.filter((g) => g.isEnabled && g.zaloAccount).map(groupPairKey);
  } catch (err) {
    loggerError('Load groups error', err);
  }
}

async function loadReports() {
  try {
    const typeParam = archiveTypeFilter.value === 'all' ? undefined : archiveTypeFilter.value;
    const res = await aiReportApi.getReports({ report_type: typeParam });
    reports.value = res.reports;
  } catch (err) {
    loggerError('Load reports error', err);
  }
}

async function loadSettings() {
  try {
    const res = await aiReportApi.getSettings();
    if (res.automation) automationSettings.value = res.automation;
    if (res.smtp) smtpSettings.value = res.smtp;
    if (res.aiProviders) {
      aiProviderSettings.value = {
        ...res.aiProviders,
        providers: {
          ...DEFAULT_AI_PROVIDERS,
          ...(res.aiProviders.providers || {}),
        },
      };
    }
  } catch (err) {
    loggerError('Load settings error', err);
  }
}

function sanitizeAiProvidersPayload(settings: AiProviderSettings): Partial<AiProviderSettings> {
  const cleanProviders: Record<string, any> = {};
  for (const [key, p] of Object.entries(settings.providers || {})) {
    cleanProviders[key] = {
      type: p.type,
      model: p.model?.trim() || undefined,
      apiKey: p.apiKey?.trim() || undefined,
      baseUrl: p.baseUrl?.trim() || undefined,
      supportsVision: p.supportsVision,
    };
  }
  return {
    primaryProvider: settings.primaryProvider,
    fallbackEnabled: settings.fallbackEnabled,
    fallbackChain: settings.fallbackChain,
    allowSystemFallback: settings.allowSystemFallback,
    providers: cleanProviders,
  };
}

async function handleSaveAiSettings() {
  isSavingAi.value = true;
  try {
    await aiReportApi.updateSettings({
      aiProviders: sanitizeAiProvidersPayload(aiProviderSettings.value),
    });
    showSnackbar('Đã lưu cấu hình AI Provider thành công!', 'success');
    await loadSettings();
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Không thể lưu cấu hình AI Provider', 'error');
  } finally {
    isSavingAi.value = false;
  }
}

async function saveAllSettings() {
  if (automationSettings.value.sendZalo && !automationSettings.value.senderAccountId) {
    showSnackbar('Vui lòng chọn tài khoản Zalo gửi báo cáo tự động', 'warning'); return;
  }
  isSavingSettings.value = true;
  try {
    await aiReportApi.updateSettings({
      aiProviders: sanitizeAiProvidersPayload(aiProviderSettings.value),
      automation: { ...automationSettings.value,
        senderAccountId: automationSettings.value.senderAccountId || undefined,
        zaloTargetUid: automationSettings.value.sendZalo && automationSettings.value.zaloDestinationType === 'uid'
          ? automationSettings.value.zaloTargetUid?.trim() || undefined : undefined,
      },
      smtp: {
        host: smtpSettings.value.host,
        port: Number(smtpSettings.value.port),
        user: smtpSettings.value.user,
        pass: smtpSettings.value.pass || undefined,
        from: smtpSettings.value.from,
      },
    });
    showSnackbar('Đã lưu cấu hình tự động hóa, AI Provider & SMTP thành công!', 'success');
  } catch (err: any) {
    showSnackbar(err?.response?.data?.error || 'Lỗi khi lưu cấu hình', 'error');
  } finally {
    isSavingSettings.value = false;
  }
}

function loggerError(msg: string, err: any) {
  console.error(`[AiReportsView] ${msg}:`, err);
}

onMounted(() => {
  applyPreset(presets[0]);
  loadGroups();
  aiReportApi.getSenderAccounts().then(accounts => { senderAccounts.value = accounts; })
    .catch(err => { showSnackbar('Không thể tải tài khoản gửi báo cáo', 'error'); loggerError('Load sender accounts', err); });
  loadReports();
  loadSettings();
  const pendingJobId = sessionStorage.getItem(pendingJobStorageKey);
  if (pendingJobId) {
    activeJobId.value = pendingJobId;
    isGenerating.value = true;
    waitForReportJob(pendingJobId).catch(err => { showSnackbar(err?.response?.data?.error || 'Không thể kiểm tra tiến độ báo cáo', 'error'); })
      .finally(() => { isGenerating.value = false; activeJobId.value = null; });
  }
});

onUnmounted(() => {
  activeJobId.value = null;
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<style scoped>
.neo-banner {
  background: var(--surface-card);
  border-bottom: 1.5px solid var(--border-color);
}

.min-height-card {
  min-height: 560px;
}

.markdown-body-rendered :deep(blockquote) {
  border-left: 3px solid #0068FF;
  background: var(--surface-variant);
  padding: 0.5rem 1rem;
  margin: 1rem 0;
  border-radius: 2px;
}

.markdown-body-rendered :deep(code) {
  font-family: monospace;
  background: var(--surface-variant);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  font-size: 0.9em;
}

.markdown-body-rendered :deep(pre) {
  background: var(--surface-variant);
  border: 1.5px solid var(--border-color);
  padding: 1rem;
  border-radius: var(--radius-btn, 8px);
  overflow-x: auto;
  margin: 1rem 0;
}

.markdown-body-rendered :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid rgba(var(--v-theme-primary), 0.2);
}

.markdown-body-rendered :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  border-left: 4px solid rgb(var(--v-theme-primary));
  padding-left: 0.75rem;
}

.markdown-body-rendered :deep(h3) {
  font-size: 1.05rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.4rem;
}

.markdown-body-rendered :deep(ul),
.markdown-body-rendered :deep(ol) {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.markdown-body-rendered :deep(li) {
  margin-bottom: 0.35rem;
  line-height: 1.6;
}

.markdown-body-rendered :deep(p) {
  margin-bottom: 0.85rem;
  line-height: 1.6;
}

.markdown-body-rendered :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin: 1.5rem 0;
}

.markdown-body-rendered :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.markdown-body-rendered :deep(th),
.markdown-body-rendered :deep(td) {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 8px 12px;
  text-align: left;
}

.markdown-body-rendered :deep(th) {
  background: rgba(var(--v-theme-surface-variant), 0.5);
  font-weight: 600;
}

/* Print Styles */
@media print {
  body * {
    visibility: hidden;
  }
  .markdown-body-rendered,
  .markdown-body-rendered * {
    visibility: visible;
  }
  .markdown-body-rendered {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
}
</style>
