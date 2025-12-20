<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '@/stores/system';
import { useSettingsStore } from '@/stores/settings';
import {
    DesktopOutlined,
    PieChartOutlined,
    ChromeOutlined,
    FieldTimeOutlined,
    LineChartOutlined,
    SyncOutlined,
    ExclamationCircleOutlined,
    CheckCircleOutlined
} from '@ant-design/icons-vue';

const systemStore = useSystemStore();
const queueData = ref([]);
const timer = ref(null);
const queueStats = ref({ processing: 0, waiting: 0, total: 0 });

// 获取队列数据
const fetchQueue = async () => {
    const settingsStore = useSettingsStore(); // 获取store
    try {
        const res = await fetch('/admin/queue', { headers: settingsStore.getHeaders() });
        if (res.ok) {
            const data = await res.json();

            // 更新统计信息
            queueStats.value = {
                processing: data.processing || 0,
                waiting: data.waiting || 0,
                total: data.total || 0
            };

            const processing = (data.processingTasks || []).map(t => ({ ...t, status: 'processing' }));
            const waiting = (data.waitingTasks || []).map(t => ({ ...t, status: 'waiting' }));
            queueData.value = [...processing, ...waiting];
        }
    } catch (e) {
        console.error('Fetch queue failed', e);
    }
};

const refreshData = async () => {
    await Promise.all([
        systemStore.fetchStatus(),
        systemStore.fetchStats(),
        fetchQueue()
    ]);
};

const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}天 ${h}小时 ${m}分`;
    if (h > 0) return `${h}小时 ${m}分`;
    return `${m}分`;
};

const formatMemory = (mb) => {
    if (!mb || mb === 0) return '0 MB';
    if (mb > 1024) {
        return parseFloat((mb / 1024).toFixed(2)) + ' GB';
    }
    return parseFloat(Number(mb).toFixed(2)) + ' MB';
};

const getLoadColor = (usage) => {
    if (usage < 50) return '#52c41a'; // 绿色
    if (usage < 80) return '#faad14'; // 橙色
    return '#f5222d'; // 红色
};

// 状态映射
const getStatusConfig = (status) => {
    const map = {
        'normal': { color: 'green', text: '正常模式 (Normal)' },
        'headless': { color: 'blue', text: '无头模式 (Headless)' },
        'xvfb': { color: 'purple', text: '虚拟显示 (Xvfb)' }
    };
    return map[status] || { color: 'red', text: '未运行' };
};

onMounted(() => {
    refreshData();
    timer.value = setInterval(refreshData, 5000); // 每5秒轮询
});

onUnmounted(() => {
    if (timer.value) clearInterval(timer.value);
});
</script>

<template>
    <a-layout style="width: 100%; background: transparent;">
        <!-- 安全模式告警横幅 -->
        <a-alert v-if="systemStore.safeMode?.enabled" type="error" show-icon style="margin-bottom: 16px;" closable>
            <template #message>
                <span style="font-weight: 600;">⚠️ 安全模式</span>
            </template>
            <template #description>
                <div>
                    <p style="margin-bottom: 8px;">
                        服务因初始化失败进入安全模式，OpenAI API 不可用。
                    </p>
                    <p style="margin-bottom: 8px; color: #cf1322;">
                        <b>原因：</b>{{ systemStore.safeMode.reason }}
                    </p>
                    <p style="margin: 0;">
                        请前往「系统设置」修改正确的配置后重启服务。
                    </p>
                </div>
            </template>
        </a-alert>

        <!-- 响应式布局：手机竖向，电脑横向 -->
        <a-row :gutter="[16, 16]" style="margin-bottom: 24px">
            <!-- 系统信息卡片 -->
            <a-col :xs="24" :md="12">
                <a-card title="系统状态" :bordered="false" style="height: 100%">
                    <a-space direction="vertical" style="width: 100%" size="middle">
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <DesktopOutlined /> 系统版本:
                            </span>
                            <b>{{ systemStore.systemVersion }}</b>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <FieldTimeOutlined /> 运行时间:
                            </span>
                            <b>{{ formatUptime(systemStore.uptime) }}</b>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <ChromeOutlined /> 状态:
                            </span>
                            <a-tag :color="getStatusConfig(systemStore.status).color">
                                {{ getStatusConfig(systemStore.status).text }}
                            </a-tag>
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>
                                    <LineChartOutlined /> CPU 使用率:
                                </span>
                                <span>{{ systemStore.cpuUsage }}%</span>
                            </div>
                            <a-progress :percent="systemStore.cpuUsage"
                                :stroke-color="getLoadColor(systemStore.cpuUsage)" :show-info="false" />
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>
                                    <PieChartOutlined /> 内存使用:
                                </span>
                                <span>{{ formatMemory(systemStore.memoryUsage.used) }} / {{
                                    formatMemory(systemStore.memoryUsage.total) }}</span>
                            </div>
                            <a-progress
                                :percent="Math.round((systemStore.memoryUsage.used / systemStore.memoryUsage.total) * 100) || 0"
                                :stroke-color="getLoadColor((systemStore.memoryUsage.used / systemStore.memoryUsage.total) * 100)"
                                :show-info="false" />
                        </div>
                    </a-space>
                </a-card>
            </a-col>

            <!-- 统计数据卡片 -->
            <a-col :xs="24" :md="12">
                <a-card title="业务统计" :bordered="false" style="height: 100%">
                    <a-row :gutter="16" style="margin-bottom: 24px">
                        <a-col :span="12">
                            <a-statistic title="窗口数量" :value="systemStore.stats.workers || 0">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">个</span>
                                </template>
                            </a-statistic>
                        </a-col>
                        <a-col :span="12">
                            <a-statistic title="实例数量" :value="systemStore.stats.instances || 0">
                                <template #suffix>
                                    <span style=" font-size: 14px; color: #8c8c8c;">个</span>
                                </template>
                            </a-statistic>
                        </a-col>
                    </a-row>
                    <a-row :gutter="16">
                        <a-col :span="12">
                            <a-statistic title="正在进行" :value="queueStats.processing">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">/ {{ queueStats.total }}</span>
                                </template>
                            </a-statistic>
                        </a-col>
                        <a-col :span="12">
                            <a-statistic title="等待排队" :value="queueStats.waiting">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">/ {{ queueStats.total }}</span>
                                </template>
                            </a-statistic>
                        </a-col>
                    </a-row>
                </a-card>
            </a-col>
        </a-row>

        <!-- 任务队列列表 -->
        <a-card title="任务队列实时监控" :bordered="false" style="width: 100%" :bodyStyle="{ padding: '0 24px' }">
            <template #extra>
                <div style="color: #8c8c8c; font-size: 12px;">
                    <SyncOutlined :spin="true" style="margin-right: 4px" /> 实时刷新中
                </div>
            </template>
            <a-list item-layout="horizontal" :data-source="queueData">
                <template #renderItem="{ item }">
                    <a-list-item>
                        <a-list-item-meta :description="`ID: ${item.id}`">
                            <template #title>
                                <span style="font-weight: 500; margin-right: 8px;">{{ item.model }}</span>
                                <a-tag v-if="item.worker" color="blue">{{ item.worker }}</a-tag>
                            </template>
                        </a-list-item-meta>

                        <div>
                            <a-tag v-if="item.status === 'processing'" color="processing">
                                <template #icon>
                                    <SyncOutlined :spin="true" />
                                </template>
                                进行中
                            </a-tag>
                            <a-tag v-else-if="item.status === 'waiting'" color="warning">
                                <template #icon>
                                    <ExclamationCircleOutlined />
                                </template>
                                等待中
                            </a-tag>
                            <a-tag v-else-if="item.status === 'success'" color="success">
                                <template #icon>
                                    <CheckCircleOutlined />
                                </template>
                                已完成
                            </a-tag>
                        </div>
                    </a-list-item>
                </template>
                <div v-if="queueData.length === 0" style="text-align: center; padding: 24px; color: #8c8c8c;">
                    暂无任务
                </div>
            </a-list>
        </a-card>
    </a-layout>
</template>