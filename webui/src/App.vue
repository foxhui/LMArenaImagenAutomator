<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Modal, message } from 'ant-design-vue';
import {
  DashboardOutlined,
  SettingOutlined,
  ToolOutlined,
  PoweroffOutlined,
  GithubOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  InboxOutlined,
  PictureOutlined
} from '@ant-design/icons-vue';
import { useSettingsStore } from '@/stores/settings';
import LoginModal from '@/components/auth/LoginModal.vue';

const router = useRouter();
const settingsStore = useSettingsStore();

const selectedKeys = ref(['dash']);
const collapsed = ref(false);
const loginVisible = ref(false);

const iconLoading = ref(false);
const enterIconLoading = () => {
  iconLoading.value = true;
  settingsStore.setToken('');
  setTimeout(() => {
    iconLoading.value = false;
    loginVisible.value = true;
  }, 500);
};

// 接口测试抽屉
const apiTestDrawer = ref(false);
const apiTestResults = ref({
  models: { status: 'pending', data: null, error: null },
  cookies: { status: 'pending', data: null, error: null },
  chat: { status: 'pending', data: null, error: null }
});
const chatTestPrompt = ref('Say hello in one word');
const chatTestModel = ref('');
const chatModelList = ref([]);
const chatImageList = ref([]);
const chatStreamMode = ref(false);
const chatStreamContent = ref('');

// 获取模型列表
const fetchModelList = async () => {
  try {
    const res = await fetch('/v1/models', { headers: settingsStore.getHeaders() });
    if (res.ok) {
      const data = await res.json();
      chatModelList.value = data.data || [];
      if (chatModelList.value.length > 0 && !chatTestModel.value) {
        chatTestModel.value = chatModelList.value[0].id;
      }
    }
  } catch (e) {
    console.error('获取模型列表失败', e);
  }
};

// 图片转 base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
};

// 图片上传前检查
const beforeUpload = (file) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    message.error('仅支持 PNG, JPEG, GIF, WebP 格式');
    return false;
  }
  if (chatImageList.value.length >= 10) {
    message.error('最多上传 10 张图片');
    return false;
  }
  return false; // 阻止自动上传，手动处理
};

// 处理图片选择
const handleImageChange = async (info) => {
  const file = info.file;
  if (file.status === 'removed') {
    chatImageList.value = chatImageList.value.filter(f => f.uid !== file.uid);
    return;
  }
  try {
    const base64 = await fileToBase64(file.originFileObj || file);
    chatImageList.value.push({
      uid: file.uid,
      name: file.name,
      base64
    });
  } catch (e) {
    message.error('图片读取失败');
  }
};

const testApi = async (type) => {
  apiTestResults.value[type].status = 'loading';
  apiTestResults.value[type].error = null;
  apiTestResults.value[type].data = null;
  chatStreamContent.value = '';

  try {
    let url, options;
    if (type === 'models') {
      url = '/v1/models';
      options = { headers: settingsStore.getHeaders() };
    } else if (type === 'cookies') {
      url = '/v1/cookies';
      options = { headers: settingsStore.getHeaders() };
    } else if (type === 'chat') {
      url = '/v1/chat/completions';

      // 构建消息内容
      let content;
      if (chatImageList.value.length > 0) {
        // 多模态请求
        content = [
          { type: 'text', text: chatTestPrompt.value }
        ];
        for (const img of chatImageList.value) {
          content.push({
            type: 'image_url',
            image_url: { url: img.base64 }
          });
        }
      } else {
        content = chatTestPrompt.value;
      }

      options = {
        method: 'POST',
        headers: { ...settingsStore.getHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatTestModel.value,
          messages: [{ role: 'user', content }],
          stream: chatStreamMode.value
        })
      };

      // 流式请求处理
      if (chatStreamMode.value) {
        const res = await fetch(url, options);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content || '';
                chatStreamContent.value += delta;
              } catch { /* 忽略解析错误 */ }
            }
          }
        }

        apiTestResults.value[type].status = 'success';
        apiTestResults.value[type].data = { content: chatStreamContent.value };
        return;
      }
    }

    const res = await fetch(url, options);
    const data = await res.json();

    if (res.ok) {
      apiTestResults.value[type].status = 'success';
      apiTestResults.value[type].data = data;
    } else {
      apiTestResults.value[type].status = 'error';
      apiTestResults.value[type].error = data.error?.message || `HTTP ${res.status}`;
    }
  } catch (e) {
    apiTestResults.value[type].status = 'error';
    apiTestResults.value[type].error = e.message;
  }
};

const openApiTestDrawer = () => {
  apiTestDrawer.value = true;
  // 重置状态
  Object.keys(apiTestResults.value).forEach(key => {
    apiTestResults.value[key] = { status: 'pending', data: null, error: null };
  });
  chatImageList.value = [];
  // 获取模型列表
  fetchModelList();
};

// 菜单 key 到路由路径的映射
const menuRoutes = {
  'dash': '/',
  'settings-server': '/settings/server',
  'settings-workers': '/settings/workers',
  'settings-browser': '/settings/browser',
  'settings-adapters': '/settings/adapters',
  'tools-display': '/tools/display',
  'tools-cache': '/tools/cache',
  'tools-logs': '/tools/logs'
};

// 处理菜单点击
const handleMenuClick = ({ key }) => {
  const route = menuRoutes[key];
  if (route) {
    router.push(route);
  }
};

const isInitializing = ref(true);

// 后端连接检测
let connectionCheckInterval = null;
let disconnectModalShown = false;

async function checkConnection() {
  try {
    const res = await fetch('/admin/status', {
      headers: settingsStore.getHeaders(),
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok && disconnectModalShown) {
      // 连接恢复，刷新页面
      disconnectModalShown = false;
      Modal.destroyAll();
      window.location.reload();
    }
  } catch (e) {
    if (!disconnectModalShown && !isInitializing.value) {
      disconnectModalShown = true;
      Modal.warning({
        title: '后端连接断开',
        content: '无法连接到后端服务，请检查服务是否正在运行。连接恢复后页面将自动刷新。',
        okText: '我知道了',
        centered: true
      });
    }
  }
}

// 挂载时检查身份验证
onMounted(async () => {
  // 响应式侧边栏
  const checkScreenSize = () => {
    if (window.innerWidth <= 768) {
      collapsed.value = true;
    }
  };
  checkScreenSize();
  window.addEventListener('resize', checkScreenSize);

  // 身份验证
  try {
    if (!settingsStore.token) {
      loginVisible.value = true;
    } else {
      // 使用真实API验证
      const isValid = await settingsStore.checkAuth();
      if (!isValid) {
        settingsStore.setToken(''); // 清除无效token
        loginVisible.value = true;
      }
    }
  } catch (e) {
    console.error('Auth check failed', e);
    loginVisible.value = true;
  } finally {
    // 隐藏加载状态
    isInitializing.value = false;
  }

  // 启动后端连接检测（每 5 秒检测一次）
  connectionCheckInterval = setInterval(checkConnection, 5000);

  // 清理监听器
  onUnmounted(() => {
    window.removeEventListener('resize', checkScreenSize);
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval);
    }
  });
});
</script>

<template>
  <a-spin :spinning="isInitializing" tip="正在验证身份..." size="large"
    style="height: 100vh; display: flex; align-items: center; justify-content: center;" v-if="isInitializing" />
  <div v-else>
    <LoginModal v-model:visible="loginVisible" />
    <a-layout style="min-height: 100vh" theme="light">
      <a-layout-header class="header"
        style="background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1.5px solid rgba(0, 0, 0, 0.05); display: flex; align-items: center; padding: 0 24px; position: fixed; width: 100%; top: 0; z-index: 1000;">
        <div class="logo" style="font-size: 1.25rem; font-weight: bold; color: #1890ff; margin-right: 24px;">
          WebAI2API
        </div>
        <a-flex justify="end" align="center" style="flex: 1;" :gap="12">
          <a-button @click="openApiTestDrawer">
            <template #icon>
              <ApiOutlined />
            </template>
            接口测试
          </a-button>
          <a-button danger :loading="iconLoading" @click="enterIconLoading">
            <template #icon>
              <PoweroffOutlined />
            </template>
            退出登录
          </a-button>
        </a-flex>
      </a-layout-header>
      <a-layout style="margin-top: 64px;">
        <a-layout-sider v-model:collapsed="collapsed" collapsible theme="light"
          style="position: fixed; left: 0; top: 64px; height: calc(100vh - 64px); overflow-y: auto; z-index: 100;">
          <a-menu v-model:selectedKeys="selectedKeys" mode="inline" @click="handleMenuClick">
            <a-menu-item key="dash">
              <DashboardOutlined />
              <span>状态概览</span>
            </a-menu-item>
            <a-sub-menu key="settings">
              <template #title>
                <span>
                  <SettingOutlined />
                  <span>系统设置</span>
                </span>
              </template>
              <a-menu-item key="settings-server">服务器</a-menu-item>
              <a-menu-item key="settings-workers">工作池</a-menu-item>
              <a-menu-item key="settings-browser">浏览器</a-menu-item>
              <a-menu-item key="settings-adapters">适配器</a-menu-item>
            </a-sub-menu>
            <a-sub-menu key="tools">
              <template #title>
                <span>
                  <ToolOutlined />
                  <span>系统管理</span>
                </span>
              </template>
              <a-menu-item key="tools-display">虚拟显示器</a-menu-item>
              <a-menu-item key="tools-cache">缓存与重启</a-menu-item>
              <a-menu-item key="tools-logs">日志查看器</a-menu-item>
            </a-sub-menu>
          </a-menu>
        </a-layout-sider>
        <a-layout
          :style="{ marginLeft: collapsed ? '80px' : '200px', padding: '16px', transition: 'margin-left 0.2s' }">
          <a-layout-content style="min-height: 280px">
            <router-view />
          </a-layout-content>
          <a-layout-footer class="footer" style="padding: 0px; margin-top: 10px;">
            <a-card :bordered="false"
              :bodyStyle="{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }">
              <div>
                <a href="https://github.com/foxhui/WebAI2API" target="_blank" style="color: #8c8c8c; font-size: 20px;">
                  <GithubOutlined />
                </a>
              </div>
            </a-card>
          </a-layout-footer>
        </a-layout>
      </a-layout>
    </a-layout>

    <!-- 接口测试抽屉 -->
    <a-drawer v-model:open="apiTestDrawer" title="接口测试" placement="right" :width="500">
      <a-space direction="vertical" style="width: 100%" size="large">
        <!-- Models 接口 -->
        <a-card title="GET /v1/models" size="small">
          <template #extra>
            <a-button size="small" type="primary" @click="testApi('models')"
              :loading="apiTestResults.models.status === 'loading'">
              测试
            </a-button>
          </template>
          <div v-if="apiTestResults.models.status === 'success'">
            <a-tag color="success">
              <CheckCircleOutlined /> 成功
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #8c8c8c;">
              返回 {{ apiTestResults.models.data?.data?.length || 0 }} 个模型
            </div>
          </div>
          <div v-else-if="apiTestResults.models.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> 失败
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f;">
              {{ apiTestResults.models.error }}
            </div>
          </div>
          <div v-else style="color: #8c8c8c; font-size: 12px;">点击测试按钮开始</div>
        </a-card>

        <!-- Cookies 接口 -->
        <a-card title="GET /v1/cookies" size="small">
          <template #extra>
            <a-button size="small" type="primary" @click="testApi('cookies')"
              :loading="apiTestResults.cookies.status === 'loading'">
              测试
            </a-button>
          </template>
          <div v-if="apiTestResults.cookies.status === 'success'">
            <a-tag color="success">
              <CheckCircleOutlined /> 成功
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #8c8c8c;">
              返回 {{ apiTestResults.cookies.data?.cookies?.length || 0 }} 个 Cookie
            </div>
          </div>
          <div v-else-if="apiTestResults.cookies.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> 失败
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f;">
              {{ apiTestResults.cookies.error }}
            </div>
          </div>
          <div v-else style="color: #8c8c8c; font-size: 12px;">点击测试按钮开始</div>
        </a-card>

        <!-- Chat 接口 -->
        <a-card title="POST /v1/chat/completions" size="small">
          <template #extra>
            <a-button size="small" type="primary" @click="testApi('chat')"
              :loading="apiTestResults.chat.status === 'loading'" :disabled="!chatTestModel">
              测试
            </a-button>
          </template>

          <!-- 模型选择 -->
          <div style="margin-bottom: 12px;">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">模型</div>
            <a-select v-model:value="chatTestModel" style="width: 100%" size="small" placeholder="选择模型" show-search>
              <a-select-option v-for="model in chatModelList" :key="model.id" :value="model.id">
                {{ model.id }}
              </a-select-option>
            </a-select>
          </div>

          <!-- 提示词 -->
          <div style="margin-bottom: 12px;">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">提示词</div>
            <a-textarea v-model:value="chatTestPrompt" placeholder="输入提示词" :rows="2" size="small" />
          </div>

          <!-- 图片上传 -->
          <div style="margin-bottom: 12px;">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">
              附加图片 ({{ chatImageList.length }}/10)
            </div>
            <a-upload-dragger :file-list="[]" :multiple="true" :before-upload="beforeUpload" @change="handleImageChange"
              accept=".png,.jpg,.jpeg,.gif,.webp" :show-upload-list="false" style="padding: 8px;">
              <p style="margin: 0;">
                <InboxOutlined style="font-size: 24px; color: #1890ff;" />
              </p>
              <p style="font-size: 12px; margin: 4px 0 0 0; color: #8c8c8c;">
                点击或拖拽上传图片 (PNG/JPEG/GIF/WebP)
              </p>
            </a-upload-dragger>
            <div v-if="chatImageList.length > 0" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
              <a-tag v-for="img in chatImageList" :key="img.uid" closable
                @close="chatImageList = chatImageList.filter(i => i.uid !== img.uid)">
                <PictureOutlined /> {{ img.name.slice(0, 15) }}{{ img.name.length > 15 ? '...' : '' }}
              </a-tag>
            </div>
          </div>

          <!-- 流式选项 -->
          <div style="margin-bottom: 12px;">
            <a-checkbox v-model:checked="chatStreamMode">流式响应</a-checkbox>
          </div>

          <!-- 测试结果 -->
          <!-- 流式模式：实时显示内容 -->
          <div v-if="chatStreamMode && apiTestResults.chat.status === 'loading'"
            style="background: #fafafa; padding: 12px; border-radius: 4px; font-size: 12px;">
            <div style="color: #1890ff; margin-bottom: 8px;">
              <LoadingOutlined /> 正在接收流式响应...
            </div>
            <pre style="white-space: pre-wrap; word-break: break-all; margin: 0; min-height: 50px;">{{ chatStreamContent ||
          '等待内容...' }}</pre>
          </div>
          <div v-else-if="apiTestResults.chat.status === 'success'">
            <a-tag color="success">
              <CheckCircleOutlined /> 成功
            </a-tag>
            <div
              style="margin-top: 8px; font-size: 12px; max-height: 200px; overflow-y: auto; background: #fafafa; padding: 8px; border-radius: 4px;">
              <pre v-if="chatStreamMode" style="white-space: pre-wrap; word-break: break-all; margin: 0;">{{
                apiTestResults.chat.data?.content || '' }}</pre>
              <pre v-else style="white-space: pre-wrap; word-break: break-all; margin: 0;">{{
                JSON.stringify(apiTestResults.chat.data, null, 2) }}</pre>
            </div>
          </div>
          <div v-else-if="apiTestResults.chat.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> 失败
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f;">
              {{ apiTestResults.chat.error }}
            </div>
          </div>
          <div v-else-if="apiTestResults.chat.status === 'loading' && !chatStreamMode"
            style="color: #1890ff; font-size: 12px;">
            <LoadingOutlined /> 请求中，可能需要较长时间...
          </div>
        </a-card>
      </a-space>
    </a-drawer>
  </div>
</template>

<style scoped>
/* 滚动条美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}
</style>
