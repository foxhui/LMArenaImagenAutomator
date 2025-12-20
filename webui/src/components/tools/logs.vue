<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
    ReloadOutlined,
    DeleteOutlined,
    SearchOutlined,
    DownloadOutlined,
    WarningOutlined,
    CloseCircleOutlined,
    InfoCircleOutlined,
    BugOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

const logs = ref([]);
const loading = ref(false);
const total = ref(0);
const autoRefresh = ref(false);
const refreshInterval = ref(null);
const searchText = ref('');
const levelFilter = ref('all');

// 日志级别配置
const levelConfig = {
    'INFO': { color: '#1890ff', icon: InfoCircleOutlined },
    'WARN': { color: '#faad14', icon: WarningOutlined },
    'ERRO': { color: '#ff4d4f', icon: CloseCircleOutlined },
    'DBUG': { color: '#722ed1', icon: BugOutlined }
};

// 获取日志
const fetchLogs = async () => {
    loading.value = true;
    try {
        const res = await fetch('/admin/logs?lines=500', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            logs.value = parseLogs(data.logs || []);
            total.value = data.total || 0;
        }
    } catch (e) {
        message.error('获取日志失败');
    } finally {
        loading.value = false;
    }
};

// 解析日志行
const parseLogs = (lines) => {
    return lines.map((line, index) => {
        // 格式: 2025-12-20 17:00:00.000 [INFO] [模块] 消息
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] \[([^\]]+)\] (.*)$/);
        if (match) {
            return {
                id: index,
                time: match[1],
                level: match[2],
                module: match[3],
                message: match[4],
                raw: line
            };
        }
        return { id: index, raw: line, level: 'INFO', time: '', module: '', message: line };
    });
};

// 过滤后的日志
const filteredLogs = computed(() => {
    return logs.value.filter(log => {
        // 级别过滤
        if (levelFilter.value !== 'all' && log.level !== levelFilter.value) {
            return false;
        }
        // 搜索过滤
        if (searchText.value) {
            const search = searchText.value.toLowerCase();
            return log.raw.toLowerCase().includes(search);
        }
        return true;
    });
});

// 清除日志
const clearLogs = () => {
    Modal.confirm({
        title: '确认清除日志',
        content: '此操作将删除所有系统日志文件，是否继续？',
        okText: '确认清除',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            try {
                const res = await fetch('/admin/logs', {
                    method: 'DELETE',
                    headers: settingsStore.getHeaders()
                });
                if (res.ok) {
                    message.success('日志已清除');
                    logs.value = [];
                    total.value = 0;
                } else {
                    message.error('清除失败');
                }
            } catch (e) {
                message.error('请求失败');
            }
        }
    });
};

// 导出日志
const exportLogs = () => {
    const content = logs.value.map(l => l.raw).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
};

// 切换自动刷新
const toggleAutoRefresh = (newState) => {
    autoRefresh.value = newState;
    if (newState) {
        fetchLogs(); // 立即刷新一次
        refreshInterval.value = setInterval(fetchLogs, 5000);
    } else {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
    }
};

onMounted(() => {
    fetchLogs();
});

onUnmounted(() => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
    }
});
</script>

<template>
    <a-card title="系统日志" :bordered="false">
        <!-- 工具栏 -->
        <div class="toolbar">
            <!-- 第一行：级别筛选和操作按钮 -->
            <div class="toolbar-row">
                <a-select v-model:value="levelFilter" style="width: 90px" size="small">
                    <a-select-option value="all">全部</a-select-option>
                    <a-select-option value="INFO">INFO</a-select-option>
                    <a-select-option value="WARN">WARN</a-select-option>
                    <a-select-option value="ERRO">ERROR</a-select-option>
                    <a-select-option value="DBUG">DEBUG</a-select-option>
                </a-select>
                <a-space :size="4">
                    <a-tooltip :title="autoRefresh ? '关闭自动刷新' : '开启自动刷新'">
                        <a-button size="small" :type="autoRefresh ? 'primary' : 'default'"
                            @click="toggleAutoRefresh(!autoRefresh)">
                            <template #icon>
                                <ReloadOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                    <a-tooltip title="导出日志">
                        <a-button size="small" @click="exportLogs">
                            <template #icon>
                                <DownloadOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                    <a-tooltip title="清除日志">
                        <a-button size="small" danger @click="clearLogs">
                            <template #icon>
                                <DeleteOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                </a-space>
            </div>
            <!-- 第二行：搜索框 -->
            <div class="toolbar-row">
                <a-input-search v-model:value="searchText" placeholder="搜索日志" size="small" enter-button allow-clear
                    style="width: 100%;" />
            </div>
        </div>

        <!-- 统计信息 -->
        <div style="margin-bottom: 12px; color: #8c8c8c; font-size: 12px;">
            共 {{ total }} 条日志，当前显示 {{ filteredLogs.length }} 条
            <span v-if="autoRefresh" style="color: #1890ff; margin-left: 8px;">
                <ReloadOutlined :spin="true" /> 自动刷新中
            </span>
        </div>

        <!-- 日志列表 -->
        <div class="log-container">
            <div v-for="log in filteredLogs" :key="log.id" class="log-line" :class="'level-' + log.level.toLowerCase()">
                <span class="log-time">{{ log.time }}</span>
                <a-tag :color="levelConfig[log.level]?.color || '#8c8c8c'" size="small" style="margin: 0 8px;">
                    {{ log.level }}
                </a-tag>
                <span class="log-module">[{{ log.module }}]</span>
                <span class="log-message">{{ log.message }}</span>
            </div>
            <a-empty v-if="filteredLogs.length === 0" description="暂无日志" />
        </div>
    </a-card>
</template>

<style scoped>
.log-container {
    max-height: 600px;
    overflow-y: auto;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    background: #fafafa;
    border-radius: 4px;
    padding: 12px;
}

.log-line {
    padding: 4px 0;
    border-bottom: 1px solid #f0f0f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.log-line:hover {
    background: #e6f7ff;
    white-space: normal;
    word-break: break-all;
}

.log-time {
    color: #8c8c8c;
}

.log-module {
    color: #1890ff;
    margin-right: 8px;
}

.log-message {
    color: #333;
}

.level-erro .log-message {
    color: #ff4d4f;
}

.level-warn .log-message {
    color: #faad14;
}

.level-dbug .log-message {
    color: #722ed1;
}

/* 工具栏样式 */
.toolbar {
    margin-bottom: 16px;
}

.toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.toolbar-row:last-child {
    margin-bottom: 0;
}

/* 大屏幕：工具栏一行显示 */
@media (min-width: 768px) {
    .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .toolbar-row {
        margin-bottom: 0;
    }

    .toolbar-row:last-child {
        flex: 1;
        max-width: 300px;
    }
}
</style>
