import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import './assets/main.css';

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(vuetify);

router.isReady()
  .then(() => {
    app.mount('#app');
  })
  .catch((err) => {
    console.error('Router initial navigation failed, mounting fallback:', err);
    app.mount('#app');
  });
