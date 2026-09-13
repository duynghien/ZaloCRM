<template>
  <div class="text-center mt-16 px-4">
    <div
      class="d-inline-flex align-center justify-center mb-6"
      style="width: 80px; height: 80px; background: var(--surface-card); border: 1.5px solid var(--border-color); border-radius: 8px;"
    >
      <v-icon icon="mdi-alert-circle-outline" size="48" color="primary" />
    </div>
    <h1 class="text-h4 font-weight-black mb-2" style="font-family: 'Space Grotesk', sans-serif;">
      404 — Không tìm thấy trang
    </h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Trang bạn đang tìm kiếm không tồn tại hoặc đã được di chuyển.
    </p>
    <v-btn to="/" color="primary" rounded="sm" elevation="0" prepend-icon="mdi-home">
      Về trang chủ
    </v-btn>
  </div>
</template>
