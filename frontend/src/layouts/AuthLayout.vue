<template>
  <div style="background-color: var(--bg-main); min-height: 100vh; width: 100%;">
    <v-main class="d-flex align-center justify-center" style="min-height: 100vh;">
      <v-container style="max-width: 450px;">
        <slot />
      </v-container>
    </v-main>
  </div>
</template>
