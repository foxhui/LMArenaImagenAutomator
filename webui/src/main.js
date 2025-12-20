import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue';
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import 'ant-design-vue/dist/reset.css';

const routes = [
    { path: '/', component: () => import('@/components/dash.vue') },
    { path: '/settings/server', component: () => import('@/components/settings/server.vue') },
    { path: '/settings/workers', component: () => import('@/components/settings/workers.vue') },
    { path: '/settings/browser', component: () => import('@/components/settings/browser.vue') },
    { path: '/settings/adapters', component: () => import('@/components/settings/adapters.vue') },
    { path: '/tools/display', component: () => import('@/components/tools/display.vue') },
    { path: '/tools/cache', component: () => import('@/components/tools/cache.vue') },
    { path: '/tools/logs', component: () => import('@/components/tools/logs.vue') },
];

const router = createRouter({
    history: createWebHistory(),
    routes
})

const pinia = createPinia()
const app = createApp(App);
app.use(pinia)
app.use(router)
app.use(Antd)
app.mount('#app')
