<script setup>
import { ref, onMounted, reactive, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { message } from 'ant-design-vue';
import { SettingOutlined, AppstoreOutlined } from '@ant-design/icons-vue';

const settingsStore = useSettingsStore();

const drawerVisible = ref(false);
const currentAdapter = ref(null);
const currentConfig = reactive({});

// 挂载时获取数据
onMounted(async () => {
    await Promise.all([
        settingsStore.fetchAdaptersMeta(),
        settingsStore.fetchAdapterConfig()
    ]);
});

// 适配器列表
const adapters = computed(() => settingsStore.adaptersMeta);

// 打开抽屉进行编辑
const handleEdit = (adapter) => {
    currentAdapter.value = adapter;
    // 加载现有配置或默认值
    const existing = settingsStore.adapterConfig[adapter.id] || {};

    // 重置当前配置表单
    Object.keys(currentConfig).forEach(key => delete currentConfig[key]);

    // 使用现有值或schema中的默认值初始化表单
    if (adapter.configSchema) {
        adapter.configSchema.forEach(field => {
            if (existing[field.key] !== undefined) {
                currentConfig[field.key] = existing[field.key];
            } else {
                currentConfig[field.key] = field.default;
            }
        });
    }

    drawerVisible.value = true;
};

// 保存配置
const handleSave = async () => {
    if (!currentAdapter.value) return;

    const configToSave = {
        [currentAdapter.value.id]: { ...currentConfig }
    };

    const success = await settingsStore.saveAdapterConfig(configToSave);
    if (success) {
        drawerVisible.value = false;
    }
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="适配器管理" :bordered="false">
            <template #extra>
                <a-button type="link" @click="settingsStore.fetchAdaptersMeta">刷新列表</a-button>
            </template>

            <a-list :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }" :data-source="adapters">
                <template #renderItem="{ item }">
                    <a-list-item>
                        <a-card hoverable @click="handleEdit(item)" :bodyStyle="{ padding: '12px 16px' }">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                                <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
                                    <AppstoreOutlined
                                        style="font-size: 18px; color: #1890ff; margin-right: 8px; flex-shrink: 0;" />
                                    <span
                                        style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{
                                        item.id }}</span>
                                </div>
                                <SettingOutlined style="font-size: 16px; color: #8c8c8c; flex-shrink: 0;" />
                            </div>
                        </a-card>
                    </a-list-item>
                </template>
            </a-list>
        </a-card>

        <!-- 配置抽屉 -->
        <a-drawer v-if="currentAdapter" v-model:open="drawerVisible" :title="`配置适配器 - ${currentAdapter.id}`" width="500"
            placement="right">
            <div v-if="!currentAdapter.configSchema || currentAdapter.configSchema.length === 0">
                <a-empty description="该适配器没有可配置项" />
            </div>

            <a-form layout="vertical" v-else>
                <template v-for="field in currentAdapter.configSchema" :key="field.key">
                    <a-form-item :label="field.label" :required="field.required">
                        <!-- 字符串输入 -->
                        <a-input v-if="field.type === 'string'" v-model:value="currentConfig[field.key]"
                            :placeholder="field.placeholder" />

                        <!-- 数字输入 -->
                        <a-input-number v-if="field.type === 'number'" v-model:value="currentConfig[field.key]"
                            :min="field.min" :max="field.max" style="width: 100%;" />

                        <!-- 布尔开关 -->
                        <div v-if="field.type === 'boolean'">
                            <a-switch v-model:checked="currentConfig[field.key]" />
                        </div>

                        <!-- 下拉选择 -->
                        <a-select v-if="field.type === 'select'" v-model:value="currentConfig[field.key]"
                            :options="field.options" />

                        <div v-if="field.note" style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
                            {{ field.note }}
                        </div>
                    </a-form-item>
                </template>
            </a-form>

            <template #footer>
                <div style="text-align: right;">
                    <a-button style="margin-right: 8px" @click="drawerVisible = false">取消</a-button>
                    <a-button type="primary" @click="handleSave">保存配置</a-button>
                </div>
            </template>
        </a-drawer>
    </a-layout>
</template>
