import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElIcons from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import './styles/tokens.css'
import './styles/global.css'

const app = createApp(App)

// 全局注册 Element Plus 图标，菜单里可直接 <component :is="'BookOpen'" />
for (const [key, comp] of Object.entries(ElIcons)) {
  app.component(key, comp)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.mount('#app')
