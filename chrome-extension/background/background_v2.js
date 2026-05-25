// background/background.js - 修复版本

// 插件配置
const PLUGIN_CONFIG = {
    apiBaseUrl: 'http://localhost:3000',
    pluginVersion: '2.0'
};

// 在 Service Worker 中生成设备指纹 - 使用 Web Crypto API 替代 Canvas
async function generateDeviceFingerprint() {
    return new Promise(async (resolve) => {
        // 首先检查本地存储中是否已有指纹
        const result = await new Promise(storageResolve => {
            chrome.storage.local.get(['deviceFingerprint'], storageResolve);
        });

        if (result.deviceFingerprint) {
            resolve(result.deviceFingerprint);
            return;
        }

        try {
            // 获取环境信息（不使用 document）
            const platform = navigator?.platform || 'unknown';
            const userAgent = navigator?.userAgent || 'unknown';
            const language = navigator?.language || 'unknown';
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';

            // 生成基础字符串
            const baseString = platform + userAgent + language + timezone + Date.now();

            // 使用 Web Crypto API 生成哈希
            const encoder = new TextEncoder();
            const data = encoder.encode(baseString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            // 生成最终指纹
            const fingerprint = `sw_${hashHex.substring(0, 16)}_${timezone}_${platform}`;

            // 保存到本地存储
            await new Promise(storageResolve => {
                chrome.storage.local.set({deviceFingerprint: fingerprint}, storageResolve);
            });

            resolve(fingerprint);
        } catch (error) {
            console.error('生成设备指纹失败:', error);
            // 降级方案：使用 UUID
            const fallbackFingerprint = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await new Promise(storageResolve => {
                chrome.storage.local.set({deviceFingerprint: fallbackFingerprint}, storageResolve);
            });
            resolve(fallbackFingerprint);
        }
    });
}

// 检查激活状态
async function checkActivationStatus() {
    let activationStatus = {isActivated: false, expiresAt: null, daysRemaining: -1};
    try {
        // 从本地存储获取激活信息
        const result = await new Promise((resolve) => {
            chrome.storage.local.get(['activationData'], (res) => resolve(res));
        });

        if (!result.activationData) {
            return {isActivated: false, daysRemaining: -1};
        }
        // 检查是否需要验证（距离上次验证超过1小时）
        const now = new Date();
        const lastVerified = result.activationData?.lastVerified;

        if (lastVerified && (now - new Date(lastVerified)) < 60 * 60 * 1000) {
            // 1小时内验证过，直接返回本地状态
            return {
                isActivated: true,
                expiresAt: result.activationData.expiresAt,
                daysRemaining: result.activationData.daysRemaining
            };
        }

        const {activationId, deviceFingerprint} = result.activationData;

        // 使用 PLUGIN_CONFIG 而不是未定义的 CONFIG
        const response = await fetch(`${PLUGIN_CONFIG.apiBaseUrl}/api/plugin/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activationId: activationId,
                deviceFingerprint: deviceFingerprint
            })
        });

        const verificationResult = await response.json();

        if (verificationResult.valid) {
            activationStatus = {
                isActivated: true,
                expiresAt: verificationResult.expiresAt,
                daysRemaining: verificationResult.daysRemaining
            };

            // 更新本地存储
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    activationData: {
                        ...result.activationData,
                        lastVerified: new Date().toISOString()
                    }
                }, () => resolve());
            });
        } else {
            // 验证失败，清除激活信息
            activationStatus = {isActivated: false, expiresAt: null, daysRemaining: -1};
            await new Promise((resolve) => {
                chrome.storage.local.remove(['activationData'], () => resolve());
            });
        }

        return activationStatus;
    } catch (error) {
        console.error('激活验证失败:', error);
        return {isActivated: false, daysRemaining: -1};
    }
}

// 激活插件
async function activatePlugin(licenseKey) {
    try {
        const deviceFingerprint = await generateDeviceFingerprint();

        // 获取平台信息
        const platformInfo = await new Promise((resolve) => {
            chrome.runtime.getPlatformInfo(resolve);
        });


        // 创建AbortController用于超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        console.log('发送激活请求，licenseKey:', licenseKey);
        console.log('发送到:', `${PLUGIN_CONFIG.apiBaseUrl}/api/plugin/activate`);

        const response = await fetch(`${PLUGIN_CONFIG.apiBaseUrl}/api/plugin/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activationCode: licenseKey,
                deviceFingerprint: deviceFingerprint,
                userAgent: navigator.userAgent || 'Chrome Extension Background Script',
                platformInfo: platformInfo,
                pluginVersion: PLUGIN_CONFIG.pluginVersion
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log('激活响应:', result);

        if (result.success) {
            // 保存激活数据
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    activationData: {
                        activationId: result.activationId,
                        expiresAt: result.expiresAt,
                        licenseKey: licenseKey,
                        deviceFingerprint: deviceFingerprint,
                        activatedAt: new Date().toISOString(),
                        lastVerified: new Date().toISOString()
                    }
                }, resolve);
            });

            return {
                success: true,
                activationId: result.activationId,
                expiresAt: result.expiresAt
            };
        } else {
            return {
                success: false,
                message: result.message
            };
        }
    } catch (error) {
        console.error('激活失败:', error);
        let errorMessage = '网络连接失败';
        if (error.name === 'AbortError') {
            errorMessage = '请求超时，请检查网络连接';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = '无法连接到激活服务器，请确认服务已启动';
        }
        return {
            success: false,
            message: errorMessage
        };
    }
}

// 验证激活状态
async function verifyActivation() {
    try {
        const status = await checkActivationStatus();

        if (!status.isActivated) {
            return {valid: false, reason: '未激活'};
        }

        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await fetch(`${PLUGIN_CONFIG.apiBaseUrl}/api/plugin/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activationId: status.activationId,
                deviceFingerprint: deviceFingerprint
            })
        });

        const result = await response.json();

        // 如果验证成功，更新本地存储的验证时间
        if (result.valid) {
            const currentData = await new Promise((resolve) => {
                chrome.storage.local.get(['activationData'], resolve);
            });
            if (currentData.activationData) {
                chrome.storage.local.set({
                    activationData: {
                        ...currentData.activationData,
                        lastVerified: new Date().toISOString()
                    }
                });
            }
        }

        return result;

    } catch (error) {
        console.error('验证失败:', error);
        return {valid: false, reason: '验证失败'};
    }
}

// 解绑插件
async function deactivatePlugin() {
    try {
        const status = await checkActivationStatus();

        if (!status.isActivated) {
            return {success: false, message: '插件未激活'};
        }

        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await fetch(`${PLUGIN_CONFIG.apiBaseUrl}/api/plugin/deactivate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                activationId: status.activationId,
                deviceFingerprint: deviceFingerprint
            })
        });

        const result = await response.json();

        if (result.success) {
            // 清除本地存储
            await new Promise((resolve) => {
                chrome.storage.local.remove(['activationData'], resolve);
            });
        }

        return result;

    } catch (error) {
        console.error('解绑失败:', error);
        return {success: false, message: '解绑失败'};
    }
}

// Service Worker 的消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background Service Worker 收到消息:', request);
    console.log('发送者:', sender);
    try {
        if (request.action === 'getActivationStatus') {
            checkActivationStatus().then(status => {
                // 计算剩余天数
                let daysUntilExpiration = -1;
                if (status.expiresAt) {
                    const diffTime = new Date(status.expiresAt) - new Date();
                    daysUntilExpiration = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                sendResponse({
                    isActivated: status.isActivated,
                    expiresAt: status.expiresAt,
                    daysUntilExpiration: daysUntilExpiration
                });
            }).catch(error => {
                console.error('获取激活状态失败:', error);
                sendResponse({success: false, error: error.message});
            });

            return true; // 保持消息通道开放，用于异步响应
        }

        if (request.action === 'activate') {
            console.log('开始激活流程，licenseKey:', request.licenseKey);
            activatePlugin(request.licenseKey).then(result => {
                console.log('激活结果:', result);
                sendResponse(result);
            }).catch(error => {
                console.error('激活过程中出错:', error);
                sendResponse({
                    success: false,
                    message: '激活过程出错: ' + error.message
                });
            });
            return true;
        }

        if (request.action === 'verify') {
            verifyActivation().then(result => {
                sendResponse(result);
            });
            return true;
        }

        if (request.action === 'deactivate') {
            deactivatePlugin().then(result => {
                sendResponse(result);
            });
            return true;
        }

    } catch (error) {
        console.error('消息处理失败:', error);
        sendResponse({success: false, error: error.message});
    }


    return false;
});

// Service Worker 安装事件
chrome.runtime.onInstalled.addListener((details) => {
    console.log('插件已安装/更新:', details.reason);

    // 设置定期验证
    chrome.alarms.create('verifyActivation', {
        periodInMinutes: 60
    });
});

// 闹钟监听器
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'verifyActivation') {
        verifyActivation().then(result => {
            if (!result.valid) {
                console.warn('激活验证失败:', result.reason);
            }
        });
    }
});

// Service Worker 激活事件
chrome.runtime.onStartup.addListener(() => {
    console.log('浏览器启动，Service Worker 激活');
    chrome.alarms.get('verifyActivation', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('verifyActivation', {
                periodInMinutes: 60
            });
        }
    });
});

console.log('Background Service Worker 已加载并准备好接收消息');