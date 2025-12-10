// 图片策略枚举
export const IMAGE_POLICY = {
    OPTIONAL: 'optional',   // 可带可不带（默认）
    REQUIRED: 'required',   // 必须有参考图
    FORBIDDEN: 'forbidden'  // 禁止带图
};

// LMArena 后端模型配置
export const LMARENA_MODELS = {
    "gemini-3-pro-image-preview-2k": {
        codeName: "019abc10-e78d-7932-b725-7f1563ed8a12",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "gemini-3-pro-image-preview": {
        codeName: "019aa208-5c19-7162-ae3b-0a9ddbb1e16a",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "flux-2-flex": {
        codeName: "019abed6-d96e-7a2b-bf69-198c28bef281",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "gemini-2.5-flash-image-preview": {
        codeName: "0199ef2a-583f-7088-b704-b75fd169401d",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "hunyuan-image-3.0": {
        codeName: "7766a45c-1b6b-4fb8-9823-2557291e1ddd",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "flux-2-pro": {
        codeName: "019abcf4-5600-7a8b-864d-9b8ab7ab7328",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "seedream-4.5": {
        codeName: "019abd43-b052-7eec-aa57-e895e45c9723",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "seedream-4-high-res-fal": {
        codeName: "32974d8d-333c-4d2e-abf3-f258c0ac1310",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "wan2.5-t2i-preview": {
        codeName: "019a5050-2875-78ed-ae3a-d9a51a438685",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "gpt-image-1": {
        codeName: "6e855f13-55d7-4127-8656-9168a9f4dcc0",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "gpt-image-mini": {
        codeName: "0199c238-f8ee-7f7d-afc1-7e28fcfd21cf",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "mai-image-1": {
        codeName: "1b407d5c-1806-477c-90a5-e5c5a114f3bc",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "seedream-3": {
        codeName: "d8771262-8248-4372-90d5-eb41910db034",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "qwen-image-prompt-extend": {
        codeName: "9fe82ee1-c84f-417f-b0e7-cab4ae4cf3f3",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "flux-1-kontext-pro": {
        codeName: "28a8f330-3554-448c-9f32-2c0a08ec6477",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "imagen-3.0-generate-002": {
        codeName: "51ad1d79-61e2-414c-99e3-faeb64bb6b1b",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "ideogram-v3-quality": {
        codeName: "73378be5-cdba-49e7-b3d0-027949871aa6",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "photon": {
        codeName: "e7c9fa2d-6f5d-40eb-8305-0980b11c7cab",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "recraft-v3": {
        codeName: "b88d5814-1d20-49cc-9eb6-e362f5851661",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "lucid-origin": {
        codeName: "5a3b3520-c87d-481f-953c-1364687b6e8f",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "gemini-2.0-flash-preview-image-generation": {
        codeName: "69bbf7d4-9f44-447e-a868-abc4f7a31810",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "dall-e-3": {
        codeName: "bb97bc68-131c-4ea4-a59e-03a6252de0d2",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "flux-1-kontext-dev": {
        codeName: "eb90ae46-a73a-4f27-be8b-40f090592c9a",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "vidu-q2-image": {
        codeName: "019adb32-afa4-749e-9992-39653b52fe13",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "imagen-4.0-fast-generate-001": {
        codeName: "f44fd4f8-af30-480f-8ce2-80b2bdfea55e",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "imagen-4.0-ultra-generate-001": {
        codeName: "019ae6da-6438-7077-9d2d-b311a35645f8",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "flux-2-dev": {
        codeName: "019ae6a0-4773-77d5-8ffb-cc35813e063c",
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "imagen-4.0-generate-001": {
        codeName: "019ae6da-6788-761a-8253-e0bb2bf2e3a9",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "wan2.5-i2i-preview": {
        codeName: "019aeb62-c6ea-788e-88f9-19b1b48325b5",
        imagePolicy: IMAGE_POLICY.REQUIRED
    },
    "hunyuan-image-2.1": {
        codeName: "a9a26426-5377-4efa-bef9-de71e29ad943",
        imagePolicy: IMAGE_POLICY.FORBIDDEN
    },
    "qwen-image-edit": {
        codeName: "995cf221-af30-466d-a809-8e0985f83649",
        imagePolicy: IMAGE_POLICY.REQUIRED
    },
    "reve-v1": {
        codeName: "0199e980-ba42-737b-9436-927b6e7ca73e",
        imagePolicy: IMAGE_POLICY.REQUIRED
    },
    "reve-fast-edit": {
        codeName: "019a5675-0a56-7835-abdd-1cb9e7870afa",
        imagePolicy: IMAGE_POLICY.REQUIRED
    }
};

// Gemini Biz 后端模型配置
export const GEMINI_BIZ_MODELS = {
    "gemini-3-pro-image-preview": {
        imagePolicy: IMAGE_POLICY.OPTIONAL
    }
};

// NanoBananaFree AI 后端模型配置
export const NANOBANANAFREE_AI_MODELS = {
    "gemini-2.5-flash-image": {
        imagePolicy: IMAGE_POLICY.OPTIONAL
    }
};

// zai.is 后端模型配置
export const ZAI_IS_MODELS = {
    "gemini-3-pro-image-preview": {
        imagePolicy: IMAGE_POLICY.OPTIONAL
    },
    "gemini-2.5-flash-image": {
        imagePolicy: IMAGE_POLICY.OPTIONAL
    }
};

/**
 * 获取后端对应的模型配置表
 * @param {string} backendName - 后端名称 ('lmarena' 或 'gemini_biz' 或 'nanobananafree_ai')
 * @returns {Object} 模型配置对象
 * @private
 */
function getModelsConfigForBackend(backendName) {
    switch (backendName) {
        case 'lmarena':
            return LMARENA_MODELS;
        case 'gemini_biz':
            return GEMINI_BIZ_MODELS;
        case 'nanobananafree_ai':
            return NANOBANANAFREE_AI_MODELS;
        case 'zai_is':
            return ZAI_IS_MODELS;
        // 将来新增其它后端：
        // case 'foo_site':
        //   return FOO_SITE_MODELS;
        default:
            return {};
    }
}

/**
 * 获取指定后端的模型列表 (OpenAI格式)
 * @param {string} backendName - 后端名称
 * @returns {Object} OpenAI 格式的模型列表
 */
export function getModelsForBackend(backendName) {
    const modelsConf = getModelsConfigForBackend(backendName);
    const modelIds = Object.keys(modelsConf);

    return {
        object: 'list',
        data: modelIds.map(id => ({
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: backendName,
            // 向前端暴露图片策略
            image_policy: modelsConf[id].imagePolicy || IMAGE_POLICY.OPTIONAL
        }))
    };
}

/**
 * 解析模型 ID
 * @param {string} backendName - 后端名称
 * @param {string} modelKey - 请求的模型键
 * @returns {string|null} 返回内部使用的 codeName，若模型无效则返回 null
 */
export function resolveModelId(backendName, modelKey) {
    const modelsConf = getModelsConfigForBackend(backendName);
    const model = modelsConf[modelKey];

    if (!model) return null; // 未配置的模型 -> 无效

    // 无 codeName 时，退回到模型 ID 本身
    return model.codeName || modelKey;
}

/**
 * 获取模型的图片策略
 * @param {string} backendName - 后端名称
 * @param {string} modelKey - 模型键
 * @returns {string} 图片策略 ('optional' | 'required' | 'forbidden')
 */
export function getImagePolicy(backendName, modelKey) {
    const modelsConf = getModelsConfigForBackend(backendName);
    const model = modelsConf[modelKey];

    if (!model || !model.imagePolicy) {
        return IMAGE_POLICY.OPTIONAL;
    }

    return model.imagePolicy;
}

