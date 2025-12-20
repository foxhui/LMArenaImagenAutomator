import { defineStore } from 'pinia';
import { message } from 'ant-design-vue';
import { useSettingsStore } from './settings';

export const useSystemStore = defineStore('system', {
    state: () => ({
        // 系统状态
        status: '',
        version: '1.0.0',
        systemVersion: '',
        uptime: 0,
        cpuUsage: 0,
        memoryUsage: {
            total: 0,
            used: 0,
            free: 0
        },

        // 安全模式状态
        safeMode: {
            enabled: false,
            reason: null
        },

        // 仪表盘统计信息
        stats: {
            totalRequests: 0,
            successRate: 0,
            activeWorkers: 0,
            totalWorkers: 0,
            avgResponseTime: 0
        }
    }),

    actions: {
        // 获取系统状态
        async fetchStatus() {
            const settingsStore = useSettingsStore();
            try {
                const response = await fetch('/admin/status', {
                    headers: settingsStore.getHeaders()
                });
                // 如果返回401，状态更新将失败，由App.vue的身份验证检查处理
                if (response.ok) {
                    const data = await response.json();
                    this.$patch(data);
                }
            } catch (error) {
                console.error('Failed to fetch system status:', error);
            }
        },

        // 获取仪表盘统计信息
        async fetchStats() {
            const settingsStore = useSettingsStore();
            try {
                const response = await fetch('/admin/stats', {
                    headers: settingsStore.getHeaders()
                });
                if (response.ok) {
                    const data = await response.json();
                    this.stats = data;
                }
            } catch (error) {
                console.error('Failed to fetch stats:', error);
            }
        },

        // 重启服务
        async restartService(options = {}) {
            const settingsStore = useSettingsStore();
            const { loginMode, workerName } = options;
            try {
                const response = await fetch('/admin/restart', {
                    method: 'POST',
                    headers: {
                        ...settingsStore.getHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ loginMode, workerName })
                });
                const data = await response.json();
                if (data.success) {
                    message.success(data.message || '服务重启中...');
                    return true;
                } else {
                    message.error('重启失败');
                    return false;
                }
            } catch (error) {
                message.error('重启请求失败');
                return false;
            }
        },

        // 停止服务
        async stopService() {
            const settingsStore = useSettingsStore();
            try {
                const response = await fetch('/admin/stop', {
                    method: 'POST',
                    headers: settingsStore.getHeaders()
                });
                const data = await response.json();
                if (data.success) {
                    message.success(data.message || '服务停止中...');
                    return true;
                } else {
                    message.error('停止失败');
                    return false;
                }
            } catch (error) {
                message.error('停止请求失败');
                return false;
            }
        }
    }
});
