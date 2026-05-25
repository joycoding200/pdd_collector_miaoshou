let isExporting = false;
let lastNoDataTime = 0;
let isCollecting = false;
let collectionQueue = null;
let activationCheckTimer = null;
let urlChangeObserver = null;
let messageListener = null;

const CONFIG = {
    panelId: 'pdd-collector-panel',
    minCollectionInterval: 20000,
    maxCollectionsPerHour: 50,
    activationCheckInterval: 5,
};

const PDD_SELECTORS = {
    skuSelectedClass: 'hr353bdX',  // 拼多多 SKU 选中态 CSS 类名，发版时可能变化
};

const DEBUG = false;
const debugLog = (...args) => DEBUG && console.log(...args);

let activationStatus = {
    isActivated: false,
    expiresAt: null,
    daysRemaining: -1
};

let lastTrialStatus = {
    isActivated: false,
    trialCount: 0,
    trialMax: 3,
    tampered: false
};

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function cleanup() {
    // 清理全局变量
    try {
        delete window.currentExportNotification;
    } catch (e) {
        console.warn('清理window属性失败:', e.message);
    }

    // 2. 清理定时器
    if (activationCheckTimer) {
        clearInterval(activationCheckTimer);
        activationCheckTimer = null;
    }
    if (collectionQueue) {
        clearTimeout(collectionQueue);
        collectionQueue = null;
    }

    // 断开URL变化监听器
    if (urlChangeObserver) {
        urlChangeObserver.disconnect();
        urlChangeObserver = null;
    }

    // 清理消息监听器
    if (messageListener) {
        window.removeEventListener('message', messageListener);
        messageListener = null;
    }

    // 清理面板 DOM 元素
    const panel = document.getElementById(CONFIG.panelId);
    const iframe = document.getElementById(CONFIG.panelId + '-iframe');
    [panel, iframe].forEach(el => {
        if (el) el.remove();
    });

    // if (panel) {
    //     const startBtn = panel.querySelector('#startCollectBtn');
    //     if (startBtn && startBtn._collectionHandler) {
    //         startBtn.removeEventListener('click', startBtn._collectionHandler);
    //     }
    //     const exportBtn = panel.querySelector('#exportDataBtn');
    //     if (exportBtn && exportBtn._exportHandler) {
    //         exportBtn.removeEventListener('click', exportBtn._exportHandler);
    //     }
    // }

    // 清理通知和对话框
    removeExistingNotifications();
}

function removeExistingNotifications() {
    const notifications = document.querySelectorAll(
        '.export-no-data-toast, .export-start-toast, .export-success-toast, .data-statistics-toast'
    );

    notifications.forEach(notification => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    });

    if (window.currentExportNotification) {
        if (window.currentExportNotification.parentNode) {
            window.currentExportNotification.parentNode.removeChild(window.currentExportNotification);
        }
        window.currentExportNotification = null;
    }
}

/**
 * 获取SKU主图和价格 需点选sku后
 */
const getSkuImageAndPrice = (dialog) => {
    try {
        const skuInfo = {};

        // 查找主图区域（第一个div）
        const firstDiv = dialog.querySelector('div:nth-child(1)');

        // 查找主图区域（有多种可能的容器）
        const possibleContainers = [
            dialog.querySelector('div:nth-child(1)'),
            dialog.querySelector('div[class*="image"], div[class*="img"]')
        ];

        let container = null;
        for (const c of possibleContainers) {
            if (c) {
                container = c;
                debugLog('找到主图容器:', c.className);
                break;
            }
        }

        if (container) {
            // 1. 查找主图
            const img = container.querySelector('img[src]');
            if (img && img.src) {
                skuInfo.imageUrl = img.src;
                debugLog('🖼️ SKU主图:', img.src);
            }
            // 2. 查找价格 - 多种查找方法
            let priceFound = false;

            //方法1：文本匹配（需改进）
            const allText = container.textContent;
            const priceRegex = /¥\s*([\d.,]+)/g;
            const matches = [...allText.matchAll(priceRegex)];

            if (matches.length > 0) {
                const priceStr = matches[0][1].replace(/,/g, '');
                skuInfo.price = parseFloat(priceStr);
                skuInfo.priceText = `¥${priceStr}`;
                priceFound = true;
                console.log('💰 通过文本匹配找到价格:', skuInfo.price);
            }

            //方法2：（通过aria-label包含¥）
            if (!priceFound) {
                const priceElement = firstDiv.querySelector('span[role="img"][aria-label*="¥"]');
                if (priceElement) {
                    const priceText = priceElement.getAttribute('aria-label');
                    skuInfo.priceText = priceText;

                    // 提取价格数字
                    const priceMatch = priceText.match(/¥([\d.]+)/);
                    if (priceMatch) {
                        skuInfo.price = parseFloat(priceMatch[1]);
                        debugLog('💰 SKU价格:', skuInfo.price);
                    }
                }
            }

            // 方法3: 查找所有span，组合价格
            if (!priceFound) {
                const priceSpans = container.querySelectorAll('span[style*="font-size"]');
                if (priceSpans.length > 0) {
                    let priceStr = '';
                    priceSpans.forEach(span => {
                        priceStr += span.textContent;
                    });

                    // 查找前面的¥符号
                    const parentText = container.textContent;
                    const yuanIndex = parentText.indexOf('¥');
                    if (yuanIndex !== -1) {
                        // 提取¥后面的数字
                        const afterYuan = parentText.substring(yuanIndex + 1);
                        const numMatch = afterYuan.match(/[\d.]+/);
                        if (numMatch) {
                            skuInfo.price = parseFloat(numMatch[0]);
                            skuInfo.priceText = `¥${numMatch[0]}`;
                            priceFound = true;
                            debugLog('💰 通过span组合找到价格:', skuInfo.price);
                        }
                    }
                }
            }

        }

        return skuInfo;
    } catch (error) {
        console.error('❌ 获取SKU主图和价格时出错:', error);
        return {};
    }
};

/**
 * 获取规格分类信息 如颜色，尺寸
 */
const getSkuSpecifications = (dialog) => {
    try {
        const specs = [];

        debugLog('🔍 查找规格分类...');

        // 方法1: 使用更通用的选择器
        /*const specContainers = dialog.querySelectorAll('div[class*="spec"], div[class*="attr"], div[class*="sku"]');
        console.log(`通用选择器找到 ${specContainers.length} 个规格容器`);

        if (specContainers.length > 0) {
          for (const container of specContainers) {
            const spec = extractSpecFromContainer(container);
            if (spec) {
              specs.push(spec);
            }
          }
        }*/


        // 方法2: 直接解析你提供的HTML结构 "sku-specs-key"
        const keyElements = dialog.querySelectorAll('span.sku-specs-key');
        console.log(`找到 ${keyElements.length} 个sku-specs-key元素`);

        if (keyElements.length > 0) {
            for (const keyElement of keyElements) {
                const keyText = keyElement.textContent.trim();
                if (!keyText || keyText.length > 20) continue;

                console.log(`发现规格: "${keyText}"`);

                // 查找该规格下的所有按钮选项
                let optionsContainer = null;

                // 情况1: 直接父容器包含按钮
                let parent = keyElement.parentElement;
                if (parent) {
                    const buttonsInParent = parent.querySelectorAll('div[role="button"]');
                    if (buttonsInParent.length > 0) {
                        optionsContainer = parent;
                        console.log(`  选项在直接父容器中: ${buttonsInParent.length} 个按钮`);
                    }
                }

                // 情况2: 兄弟div包含按钮
                if (!optionsContainer) {
                    let sibling = keyElement.nextElementSibling;
                    while (sibling) {
                        if (sibling.tagName === 'DIV') {
                            const buttonsInSibling = sibling.querySelectorAll('div[role="button"]');
                            if (buttonsInSibling.length > 0) {
                                optionsContainer = sibling;
                                console.log(`  选项在兄弟div中: ${buttonsInSibling.length} 个按钮`);
                                break;
                            }
                        }
                        sibling = sibling.nextElementSibling;
                    }
                }

                // 情况3: 父容器的兄弟包含按钮
                if (!optionsContainer && keyElement.parentElement) {
                    let parentSibling = keyElement.parentElement.nextElementSibling;
                    while (parentSibling) {
                        if (parentSibling.tagName === 'DIV') {
                            const buttonsInParentSibling = parentSibling.querySelectorAll('div[role="button"]');
                            if (buttonsInParentSibling.length > 0) {
                                optionsContainer = parentSibling;
                                console.log(`  选项在父容器的兄弟中: ${buttonsInParentSibling.length} 个按钮`);
                                break;
                            }
                        }
                        parentSibling = parentSibling.nextElementSibling;
                    }
                }

                if (optionsContainer) {
                    // 提取选项
                    const values = extractOptionsFromButtonElements(optionsContainer);

                    if (values.length > 0) {
                        specs.push({
                            key: keyText,
                            element: keyElement,
                            values: values,
                            currentIndex: values.findIndex(v => v.isSelected) || 0
                        });

                        console.log(`  已添加规格 "${keyText}"，包含 ${values.length} 个选项`);
                    } else {
                        console.warn(`  规格 "${keyText}" 未找到可用选项`);
                    }
                } else {
                    console.warn(`  规格 "${keyText}" 未找到选项容器`);
                }
            }
        } else {
            console.log('未找到sku-specs-key元素，尝试其他查找方式...');
        }

        // 方法3: 如果上述方法失败，尝试通过文本查找
        if (specs.length === 0) {
            console.log('尝试通过文本查找规格分类...');

            // 查找所有包含规格关键词的文本
            const allTextElements = dialog.querySelectorAll('span, div, p');
            const specKeywords = ['颜色', '尺码', '规格', '型号', '款式', '口味', '尺寸'];

            for (const element of allTextElements) {
                const text = element.textContent.trim();

                for (const keyword of specKeywords) {
                    if (text === keyword || text.includes(keyword)) {
                        console.log(`找到规格关键词: "${text}"`);
                        const spec = extractSpecFromElement(element);
                        if (spec) {
                            specs.push(spec);
                        }
                        break;
                    }
                }
            }
        }

        console.log(`📊 最终找到 ${specs.length} 个规格分类`);

        if (specs.length > 0) {
            specs.forEach((spec, index) => {
                console.log(`规格 ${index + 1}: ${spec.key} (${spec.values.length} 个选项)`);
                spec.values.forEach((value, i) => {
                    console.log(`  ${i + 1}. ${value.text} ${value.isSelected ? '✅' : ''}`);
                });
            });
        }

        return specs;
    } catch (error) {
        console.error('❌ 获取规格分类时出错:', error);
        return [];
    }
};

/**
 * 从按钮容器中提取选项
 */
const extractOptionsFromButtonElements = (container) => {
    const values = [];

    try {
        // 查找所有按钮
        const buttons = container.querySelectorAll('div[role="button"]');
        console.log(`在容器中找到 ${buttons.length} 个按钮`);

        buttons.forEach((button, index) => {
            // 优先使用aria-label，如果没有则使用文本内容
            let optionText = button.getAttribute('aria-label') || '';

            if (!optionText || optionText.trim() === '') {
                optionText = button.textContent.trim();
            }

            optionText = optionText.trim();

            // 过滤无效文本
            if (!optionText || optionText.length > 200) return;

            // 检查是否被禁用
            const isDisabled = checkIfElementDisabled(button);

            // 检查是否选中
            const classList = button.getAttribute('class') || '';
            const isSelected = classList.includes(PDD_SELECTORS.skuSelectedClass) || // PDD option 选中的样式
                classList.includes('selected') ||
                classList.includes('active') ||
                button.getAttribute('aria-checked') === 'true' ||
                (button.getAttribute('aria-label') || '').includes('已选中');

            values.push({
                element: button,
                text: optionText,
                ariaLabel: button.getAttribute('aria-label') || '',
                rawText: button.textContent.trim(),
                index: index,
                isSelected: isSelected,
                isDisabled: isDisabled,
                classList: classList
            });
        });
    } catch (error) {
        console.error('提取选项失败:', error);
    }

    // 去重：基于文本内容去重
    const uniqueValues = [];
    const seenTexts = new Set();

    for (const value of values) {
        if (!seenTexts.has(value.text)) {
            seenTexts.add(value.text);
            uniqueValues.push(value);
        }
    }

    console.log(`  去重后: ${uniqueValues.length} 个唯一选项`);

    return uniqueValues;
};

/**
 * 从容器中提取规格信息
 */
const extractSpecFromContainer = (container) => {
    try {
        // 查找规格名称 唯一特征
        let keyElement = container.querySelector('.sku-specs-key');

        if (!keyElement) return null;

        const keyText = keyElement.textContent.trim();
        if (!keyText || keyText.length > 20) return null; // 排除太长的文本

        // 查找选项
        const values = extractOptionsFromContainer(container);

        if (values.length > 0) {
            return {
                key: keyText,
                element: keyElement,
                values: values,
                currentIndex: values.findIndex(v => v.isSelected) || 0
            };
        }

        return null;
    } catch (error) {
        console.error('提取规格信息失败:', error);
        return null;
    }
};

/**
 * 从容器中提取选项
 */
const extractOptionsFromContainer = (container) => {
    const values = [];

    try {
        // 查找所有按钮元素
        const buttonElements = container.querySelectorAll('div[role="button"], button');

        buttonElements.forEach((button, index) => {
            const buttonText = button.textContent.trim();

            // 过滤掉太短或太长的文本
            if (buttonText && buttonText.length > 1 && buttonText.length < 100) {
                // 检查是否选中状态
                const classList = button.getAttribute('class') || '';
                const ariaChecked = button.getAttribute('aria-checked');
                const isSelected = classList.includes('selected') ||
                    classList.includes('active') ||
                    ariaChecked === 'true' ||
                    button.getAttribute('aria-label')?.includes('当前选择');

                values.push({
                    element: button,
                    text: buttonText,
                    index: index,
                    isSelected: isSelected,
                    class: classList,
                    ariaLabel: button.getAttribute('aria-label') || ''
                });
            }
        });
    } catch (error) {
        console.error('提取选项失败:', error);
    }

    return values;
};

/**
 * 从元素中提取规格信息
 */
const extractSpecFromElement = (element) => {
    try {
        const keyText = element.textContent.trim();

        // 向上查找包含按钮的容器
        let container = element.parentElement;
        let foundButtons = false;

        // 向上查找3层
        for (let i = 0; i < 3; i++) {
            if (container) {
                const buttons = container.querySelectorAll('div[role="button"]');
                if (buttons.length > 1) {
                    foundButtons = true;
                    break;
                }
                container = container.parentElement;
            }
        }

        if (foundButtons && container) {
            const values = extractOptionsFromContainer(container);

            if (values.length > 0) {
                return {
                    key: keyText,
                    element: element,
                    values: values,
                    currentIndex: values.findIndex(v => v.isSelected) || 0
                };
            }
        }

        return null;
    } catch (error) {
        console.error('从元素提取规格失败:', error);
        return null;
    }
};

/**
 * 检查元素是否被禁用
 */
const checkIfElementDisabled = (element) => {
    // 检查常见的禁用标志
    const classList = element.getAttribute('class') || '';
    const style = element.getAttribute('style') || '';
    const ariaDisabled = element.getAttribute('aria-disabled');
    const disabledAttr = element.getAttribute('disabled');

    // 通过class判断
    if (classList.includes('disabled') ||
        classList.includes('unavailable') ||
        classList.includes('sold-out') ||
        classList.includes('out-of-stock')) {
        return true;
    }

    // 通过属性判断
    if (ariaDisabled === 'true' || disabledAttr !== null) {
        return true;
    }

    if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
    }
    // 通过样式判断（灰色通常表示禁用）
    if (style.includes('opacity: 0.5') ||
        style.includes('opacity:.5') ||
        style.includes('color: #999') ||
        style.includes('color:#999') ||
        style.includes('background-color: #f5f5f5')) {
        return true;
    }


    // 检查父元素是否禁用
    let parent = element.parentElement;
    for (let i = 0; i < 3; i++) { // 向上检查3层
        if (parent) {
            const parentClass = parent.getAttribute('class') || '';
            if (parentClass.includes('disabled')) {
                return true;
            }
            parent = parent.parentElement;
        }
    }

    return false;
};

// 初始化函数
function init() {
    console.log('初始化采集助手...');

    // 清理之前的组件
    cleanup();

    // 注入面板
    injectPanel();

    // 设置自动检测URL
    setupAutoDetection();

    //定时检测激活状态
    setupActivationCheck();
}

function setupAutoDetection() {
    // 先断开原有监听器
    if (urlChangeObserver) {
        urlChangeObserver.disconnect();
    }

    // 监听URL变化（单页应用）
    let lastUrl = location.href;
    //缩小监听范围：仅监听head/body（URL变化通常会修改title/meta）
    const observeTargets = [document.head, document.body].filter(Boolean);
    if (observeTargets.length === 0) return;

    urlChangeObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log('🌐 URL变化，重新初始化...');

            // 防抖：1.5秒内多次变化仅执行一次
            setTimeout(() => {
                cleanup();
                init();
            }, 1500);
        }
    });

    //urlChangeObserver.observe(document, {subtree: true, childList: true});
    // 仅监听必要的变化类型（减少回调触发）
    observeTargets.forEach(target => {
        urlChangeObserver.observe(target, {
            childList: true,
            subtree: false, // 关闭子树监听，仅监听当前节点
            attributes: true,
            attributeFilter: ['href', 'src', 'title'] // 仅监听URL相关属性
        });
    });
}

// 注入面板
async function injectPanel() {
    // 移除可能存在的旧面板
    const existingPanel = document.getElementById(CONFIG.panelId);
    if (existingPanel) {
        existingPanel.remove();
    }

    // 检查激活状态
    const status = await getActivationStatus();
    activationStatus = {
        isActivated: status.isActivated,
        expiresAt: status.expiresAt,
        daysRemaining: status.daysUntilExpiration
    };

    // 创建iframe加载panel.html
    const iframe = document.createElement('iframe');
    iframe.id = CONFIG.panelId + '-iframe';
    iframe.src = chrome.runtime.getURL('panel/panel.html');
    iframe.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 400px;
        height: 500px;
        border: none;
        z-index: 2147483645;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        background: transparent;
        background-color: transparent;
    `;

    document.body.appendChild(iframe);

    // 等待iframe加载完成
    iframe.onload = async function () {
        const trialStatus = await getTrialStatusFromBg();

        // 传递激活状态和试用状态到iframe
        sendSafeMessage(iframe.contentWindow, {
            type: 'init',
            activationStatus: activationStatus,
            trialStatus: trialStatus
        });

        // 建立消息通信
        setupMessageCommunication(iframe);
    };
}

// 建立消息通信
function setupMessageCommunication(iframe) {
    if (messageListener) {
        window.removeEventListener('message', messageListener);
    }
    // 1. 获取插件的合法origin（避免*）
    const pluginOrigin = new URL(chrome.runtime.getURL('')).origin;

    messageListener = async function (event) {
        // 2. 双重校验：source + origin
        if (event.source !== iframe.contentWindow || event.origin !== pluginOrigin) return;
        // if (event.source !== iframe.contentWindow) return;

        // 3. 消息Schema校验
        const {type, data} = event.data || {};
        if (!type || typeof type !== 'string') return;

        switch (type) {
            case 'startCollection':
                startCollection();
                break;

            case 'exportData':
                exportDataToExcel();
                break;

            case 'closePanel':
                iframe.remove();
                break;

            case 'activate':
                await handleActivation(data.activationCode, iframe);
                break;

            case 'getActivationStatus':
                const status = await getActivationStatus();
                const trial = await getTrialStatusFromBg();
                sendSafeMessage(iframe.contentWindow, {
                    type: 'activationStatus',
                    status: status,
                    trialStatus: trial
                });
                break;
            case 'activationStatusUpdate':
                handleActivationStatusUpdate(iframe, data);
                break;

            case 'panelResize':
                adjustIframeSize(iframe, data);
                break;
        }
    };

    window.addEventListener('message', messageListener);
}

// 封装postMessage工具函数（全局复用）
function sendSafeMessage(targetWindow, message, targetOrigin = new URL(chrome.runtime.getURL('')).origin) {
    if (!targetWindow || !message || !targetOrigin) return;
    targetWindow.postMessage(message, targetOrigin);
}

// 通知 panel iframe
function notifyPanel(type, data = {}) {
    const iframe = document.getElementById(CONFIG.panelId + '-iframe');
    if (iframe?.contentWindow) {
        sendSafeMessage(iframe.contentWindow, { type, ...data });
    }
}

// 获取试用状态（通过background.js）
async function getTrialStatusFromBg() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getTrialStatus' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve({ isActivated: false, trialCount: 0, trialMax: 3, tampered: false });
                return;
            }
            resolve(response);
        });
    });
}

// 获取激活状态（通过background.js）
async function getActivationStatus() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({action: 'getActivationStatus'}, (response) => {
            // 1. 处理runtime错误
            if (chrome.runtime.lastError) {
                console.error('获取激活状态失败:', chrome.runtime.lastError);
                resolve({
                    isActivated: false,
                    expiresAt: null,
                    daysUntilExpiration: -1
                });
                return;
            }

            // 2. 校验响应格式
            if (!response || typeof response !== 'object') {
                resolve({isActivated: false, expiresAt: null, daysUntilExpiration: -1});
                return;
            }

            // 3. 兜底默认值
            resolve({
                isActivated: !!response.isActivated,
                expiresAt: response.expiresAt || null,
                daysUntilExpiration: Number.isInteger(response.daysUntilExpiration)
                    ? response.daysUntilExpiration
                    : -1
            });
        });
    });
}

//新增激活状态定时检查
function setupActivationCheck() {
    // 清理旧定时器
    if (activationCheckTimer) clearInterval(activationCheckTimer);

    activationCheckTimer = setInterval(async () => {
        try {
            const newStatus = await getActivationStatus();
            const newTrial = await getTrialStatusFromBg();
            // 状态变化时更新并通知面板
            if (JSON.stringify(newStatus) !== JSON.stringify(activationStatus)) {
                activationStatus = newStatus;
                const iframe = document.getElementById(CONFIG.panelId + '-iframe');
                if (iframe?.contentWindow) {
                    sendSafeMessage(iframe.contentWindow, {
                        type: 'activationStatus',
                        status: activationStatus,
                        trialStatus: newTrial
                    });
                }
            } else if (JSON.stringify(newTrial) !== JSON.stringify(lastTrialStatus)) {
                // 试用状态变化（如采集后次数减少）
                lastTrialStatus = newTrial;
                const iframe = document.getElementById(CONFIG.panelId + '-iframe');
                if (iframe?.contentWindow) {
                    sendSafeMessage(iframe.contentWindow, {
                        type: 'trialStatusUpdate',
                        trialStatus: newTrial
                    });
                }
            }
        } catch (e) {
            console.error('定时检查激活状态失败:', e);
        }
    }, CONFIG.activationCheckInterval * 60 * 1000);
}


// 处理激活（通过background.js）
async function handleActivation(activationCode, iframe) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'activate',
            licenseKey: activationCode
        }, async (response) => {
            if (chrome.runtime.lastError) {
                console.error('激活请求失败:', chrome.runtime.lastError);
                if (iframe && iframe.contentWindow) {
                    sendSafeMessage(iframe.contentWindow, {
                        type: 'activationError',
                        message: '激活请求失败，请检查网络连接'
                    });
                }
                resolve({success: false, message: '激活请求失败'});
                return;
            }

            if (response.success) {
                // 更新本地状态
                activationStatus = {
                    isActivated: true,
                    expiresAt: response.expiresAt,
                    daysRemaining: response.daysUntilExpiration
                };
                console.log('激活成功，状态:', activationStatus);
                // 发送更新消息到iframe
                if (iframe && iframe.contentWindow) {
                    sendSafeMessage(iframe.contentWindow, {
                        type: 'activationSuccess',
                        activationStatus: activationStatus
                    });
                }

                resolve({success: true});
            } else {
                // 激活失败，发送错误消息到iframe
                if (iframe && iframe.contentWindow) {
                    sendSafeMessage(iframe.contentWindow, {
                        type: 'activationError',
                        message: response.message
                    });
                }
                resolve({success: false, message: response.message});
            }
        });
    });
}

function adjustIframeSize(iframe, data) {
    const mode = data.mode || (data.isActivated ? 'activated' : 'inactive');
    if (mode === 'activated' || mode === 'trial') {
        iframe.style.width = '400px';
        iframe.style.height = '60px';
        iframe.style.top = 'auto';
        iframe.style.bottom = '20px';
        iframe.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';
        iframe.style.borderRadius = '10px';
    } else {
        iframe.style.width = '400px';
        iframe.style.height = '550px';
        iframe.style.top = 'auto';
        iframe.style.bottom = '20px';
        iframe.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
        iframe.style.borderRadius = '12px';
    }
}

// 新增：激活状态更新处理核心函数（单独抽离，便于维护）
/**
 * 处理激活状态更新，同步全局状态+调整面板UI
 * @param {HTMLIFrameElement} iframe - 插件面板iframe
 * @param {Object} newStatus - 新的激活状态 { isActivated, expiresAt, daysUntilExpiration }
 */
function handleActivationStatusUpdate(iframe, newStatus) {
    try {
        // 1. 校验新状态格式
        if (!newStatus || typeof newStatus !== 'object') {
            console.warn('激活状态更新失败：状态格式非法', newStatus);
            return;
        }

        // 确保必要字段存在
        const isValidStatus = 'isActivated' in newStatus &&
            'expiresAt' in newStatus &&
            'daysUntilExpiration' in newStatus;

        if (!isValidStatus) {
            console.warn('激活状态更新失败：缺少必要字段', newStatus);
            return;
        }

        // 2. 同步更新全局激活状态（关键！保证主进程状态和面板一致）
        activationStatus = {...newStatus};
        const {isActivated, daysUntilExpiration} = newStatus;

        // 3. 联动调整面板UI（复用原有尺寸调整函数，保证样式统一）
        adjustIframeSize(iframe, {isActivated});

        // 4. 状态变更提示（使用已有的通知函数）
        if (!isActivated && daysUntilExpiration === 0) {
            // 使用已有的激活要求通知函数
            showActivationRequiredNotification('您的插件激活已过期，请重新激活后使用');
        } else if (!isActivated && daysUntilExpiration < 0) {
            showActivationRequiredNotification('插件未激活，部分功能无法使用');
        }

        console.log('✅ 激活状态已同步更新', activationStatus);
    } catch (e) {
        console.error('❌ 处理激活状态更新失败', e.message);
    }
}


async function startCollection() {
    // 1. Check Activation or Trial
    if (!activationStatus.isActivated) {
        const trialStatus = await getTrialStatusFromBg();
        if (trialStatus.tampered) {
            showCollectionError('试用数据异常，请激活后使用');
            return;
        }
        if (trialStatus.trialCount <= 0) {
            showActivationRequiredNotification('试用次数已用完，请激活后继续使用');
            return;
        }
        // 扣减试用次数并即刻通知面板
        chrome.runtime.sendMessage({ action: 'consumeTrial' }, async (resp) => {
            if (resp && resp.success) {
                const newTrial = await getTrialStatusFromBg();
                lastTrialStatus = newTrial;
                notifyPanel('trialStatusUpdate', { trialStatus: newTrial });
            }
        });
    }

    // 2. Check Lock
    if (isCollecting) {
        console.log('采集正在进行中，请稍候...');
        return;
    }

    isCollecting = true;
    notifyPanel('setButtonsEnabled', { enabled: false });

    // 3. Clear Queue
    if (collectionQueue) {
        clearTimeout(collectionQueue);
        collectionQueue = null;
    }

    // 4. Start Process
    collectionQueue = setTimeout(async () => {
        try {
            console.log('开始采集商品数据...');

            // --- REAL SCRAPING LOGIC START (Adapted from File 2) ---

            // Optional: Scroll to trigger lazy loading
            await simulateHumanBehavior();

            const title = await grabProductTitle();
            const mainImages = await getMainImages();
            const descriptionImages = await getDescriptionImages();
            const skuResult = await grabAllSkuInfoImproved();

            const realData = {
                title: title || '未找到商品标题',
                skuInfo: skuResult.skus || [],
                mainImages: mainImages,
                mainImagesStr: mainImages.join(','),
                descriptionImages: descriptionImages,
                descriptionImagesStr: descriptionImages.join(','),
                url: cleanProductUrl(window.location.href),
                collectedAt: new Date().toISOString()
            };
            // --- REAL SCRAPING LOGIC END ---

            console.log('📊 采集完成:', realData.title);

            // Save Data (Using the de-duplication logic)
            await saveProductData(realData);

            // Show Success
            showCollectionSuccess(realData);

        } catch (error) {
            console.error('采集失败:', error);
            showCollectionError(error.message);
        } finally {
            isCollecting = false;
            collectionQueue = null;
            // 恢复按钮文字并刷新试用状态
            notifyPanel('setButtonsEnabled', { enabled: true });
            getTrialStatusFromBg().then(trial => {
                lastTrialStatus = trial;
                notifyPanel('trialStatusUpdate', { trialStatus: trial });
            });
        }
    }, 300);
}

// 保存商品数据
async function saveProductData(productData) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['productDataList'], (result) => {
            let productList = result.productDataList || [];

            // Check for duplicates based on URL
            const existingIndex = productList.findIndex(item => item.url === productData.url);

            if (existingIndex !== -1) {
                // Update existing
                productList[existingIndex] = productData;
                console.log('Updated existing product');
            } else {
                // Add new
                productList.unshift(productData);
                console.log('Added new product');
            }

            // Limit storage to 100 items
            if (productList.length > 100) {
                productList = productList.slice(0, 100);
            }

            chrome.storage.local.set({
                'productDataList': productList
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve({success: true, count: productList.length});
                }
            });
        });
    });
}

// 导出数据到Excel
async function exportDataToExcel() {
    console.log('📤 开始导出数据到Excel...');

    // 防止重复执行
    if (isExporting) {
        console.log('导出正在进行中，请稍候...');
        return Promise.resolve();
    }

    isExporting = true;

    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['productDataList'], async (result) => {
            try {
                const productList = result.productDataList || [];

                if (!productList || productList.length === 0) {
                    // 显示无数据提示
                    // 检查冷却时间（2秒内不重复显示）
                    const now = Date.now();
                    if (now - lastNoDataTime > 2000) {
                        lastNoDataTime = now;
                        showNoDataNotification();
                    }

                    console.log('📭 没有可导出的商品数据');
                    resolve(); // 正常结束，不视为错误
                    return;
                }

                // 显示开始导出提示，包含商品数量
                showExportStartNotification(productList.length);

                // 准备Excel数据
                const excelData = prepareExcelData(productList);

                // 创建Excel文件
                const workbook = createWorkbook(excelData);

                // 生成Excel文件并下载
                const format = await downloadExcel(workbook);

                // ✅ 导出成功后清除本地存储
                await clearLocalStorage();

                // 显示导出成功提示
                showExportSuccess(productList.length, format);

                console.log('✅ 数据导出完成');
                resolve();

            } catch (error) {
                console.error('导出数据失败:', error);
                reject(error);
            } finally {
                isExporting = false;
            }
        });
    });
}

// 显示激活要求通知
function showActivationRequiredNotification(msg) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 90px;
        background: #f39c12;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 2147483646;
        font-size: 14px;
        max-width: 300px;
        animation: fadeIn 0.3s;
    `;

    notification.innerHTML = `
        ⚠️ 需要激活<br/>
        <small>${msg}</small>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 显示采集成功提示
function showCollectionSuccess(data) {
    const notification = document.createElement('div');
    notification.className = 'collect-success-toast';
    notification.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 150px;
        background: #27ae60;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 2147483646;
        font-size: 14px;
        max-width: 300px;
        animation: fadeIn 0.3s;
    `;

    notification.innerHTML = `
        ✅ 采集成功！<br/>
        <small>${data.title.substring(0, 35)}${data.title.length > 35 ? '...' : ''}</small>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 显示采集错误提示
function showCollectionError(errorMsg) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 90px;
        background: #f44336;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 2147483646;
        font-size: 14px;
        max-width: 300px;
        animation: fadeIn 0.3s;
    `;

    notification.innerHTML = `
        ❌ 采集失败<br/>
        <small>${errorMsg.substring(0, 50)}${errorMsg.length > 50 ? '...' : ''}</small>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 显示无数据提示
function showNoDataNotification() {
    const notification = document.createElement('div');
    notification.className = 'export-no-data-toast';
    notification.style.cssText = `
        position: fixed;
        right: 15px;
        bottom: 210px;
        background: rgba(255, 193, 7, 0.95);
        backdrop-filter: blur(8px);
        color: #333;
        padding: 14px 20px;
        border-radius: 10px;
        box-shadow: 0 6px 25px rgba(255, 193, 7, 0.25);
        z-index: 2147483646;
        font-size: 13px;
        max-width: 320px;
        animation: slideUp 0.3s ease;
        border: 1px solid rgba(255, 255, 255, 0.3);
    `;

    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">暂无数据</div>
        <div style="font-size: 12px; opacity: 0.9;">
            请先点击"开始采集"按钮采集商品数据
        </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 显示导出开始提示
function showExportStartNotification(count) {
    const notification = document.createElement('div');
    notification.className = 'export-start-toast';
    notification.style.cssText = `
        position: fixed;
        right: 15px;
        bottom: 210px;
        background: rgba(33, 150, 243, 0.95);
        backdrop-filter: blur(8px);
        color: white;
        padding: 14px 20px;
        border-radius: 10px;
        box-shadow: 0 6px 25px rgba(33, 150, 243, 0.25);
        z-index: 2147483646;
        font-size: 13px;
        max-width: 320px;
        animation: slideUp 0.3s ease;
    `;

    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">正在导出数据...</div>
        <div style="font-size: 12px; opacity: 0.9;">
            共 ${count} 个商品数据，请稍候
        </div>
    `;

    document.body.appendChild(notification);
    window.currentExportNotification = notification;
}

// 显示导出成功提示
function showExportSuccess(count, format = 'xlsx') {
    if (window.currentExportNotification) {
        window.currentExportNotification.remove();
        window.currentExportNotification = null;
    }

    const notification = document.createElement('div');
    notification.className = 'export-success-toast';
    notification.style.cssText = `
        position: fixed;
        right: 15px;
        bottom: 210px;
        background: rgba(76, 175, 80, 0.95);
        backdrop-filter: blur(8px);
        color: white;
        padding: 12px 18px;
        border-radius: 10px;
        box-shadow: 0 6px 25px rgba(76, 175, 80, 0.25);
        z-index: 2147483646;
        font-size: 13px;
        max-width: 300px;
        animation: slideUp 0.3s ease;
    `;

    const suffix = format === 'xlsx' ? 'xlsx' : 'csv';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    notification.innerHTML = `
        <div style="font-weight: 600;">导出成功！</div>
        <div style="font-size: 12px; opacity: 0.9;">
            已导出 ${count} 个商品数据<br>
            文件名: 商品数据_${timestamp}.${suffix}
        </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 显示导出错误提示
function showExportError(errorMsg) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        right: 15px;
        bottom: 210px;
        background: #f44336;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 2147483646;
        font-size: 14px;
        max-width: 300px;
        animation: fadeIn 0.3s;
    `;

    notification.innerHTML = `
        ❌ 导出失败<br/>
        <small>${errorMsg.substring(0, 50)}${errorMsg.length > 50 ? '...' : ''}</small>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// 模拟鼠标移动和滚动行为
const simulateHumanBehavior = async () => {
    // 随机滚动页面
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
    });

    await humanWait(300, 600);

    // 轻微回滚，模拟真实浏览
    window.scrollBy({
        top: -scrollAmount / 3,
        behavior: 'smooth'
    });

    await humanWait(200, 400);
};

//改进版 - 模拟人工浏览
const humanWait = async (min, max, jitter = 0.3) => {
    const baseDelay = Math.random() * (max - min) + min;
    const jitterAmount = baseDelay * (Math.random() * jitter * 2 - jitter);
    const totalDelay = Math.max(100, baseDelay + jitterAmount);

    // 模拟人类打字或思考的微小停顿
    if (Math.random() > 0.7) {
        await new Promise(resolve => setTimeout(resolve, totalDelay * 0.3));
        await new Promise(resolve => setTimeout(resolve, totalDelay * 0.7));
    } else {
        await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
};

// 建议：模拟真实点击
const humanClick = async (element) => {
    const rect = element.getBoundingClientRect();

    // 1. 随机移动到元素附近
    await simulateMouseMoveTo(rect.x + rect.width / 2, rect.y + rect.height / 2);

    // 2. 小范围随机偏移
    const offsetX = (Math.random() - 0.5) * 10;
    const offsetY = (Math.random() - 0.5) * 10;

    // 3. 触发mouseover、mousedown、mouseup等事件
    const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
    for (const eventType of events) {
        await humanWait(50, 150);
        element.dispatchEvent(new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            clientX: rect.x + rect.width / 2 + offsetX,
            clientY: rect.y + rect.height / 2 + offsetY
        }));
    }
};

//模拟人鼠标移动到
const simulateMouseMoveTo = async (targetX, targetY) => {

    // 简单实现：只滚动到大致位置
    window.scrollTo({
        left: targetX - window.innerWidth / 2,
        top: targetY - window.innerHeight / 2,
        behavior: 'smooth'
    });
    await humanWait(300, 600);
}

// 查找商品标题元素
const findTitleElement = () => {
    // 方法1: 直接通过CSS选择器查找
    const titleElement = document.querySelector('span.enable-select');
    if (titleElement) return titleElement;

    // 方法2: 尝试更宽泛的查找
    const allEnableSelects = document.querySelectorAll('span.enable-select');
    for (const element of allEnableSelects) {
        const text = element.textContent.trim();
        if (text && text.length > 0 && text.length < 100) {
            return element;
        }
    }

    // 方法3: 查找包含商品标题的容器
    const possibleContainers = document.querySelectorAll('div[class*="title"], div[class*="name"]');
    for (const container of possibleContainers) {
        const spans = container.querySelectorAll('span.enable-select');
        if (spans.length > 0) return spans[0];
    }

    return null;
};


const grabProductTitle = async () => {
    console.log('🕵️ 开始抓取拼多多商品标题...');

    try {
        // 第三步: 查找商品标题元素
        console.log('正在查找商品标题元素...');
        let titleElement = findTitleElement();

        // 如果没找到，重试几次
        let retryCount = 0;
        const maxRetries = 3;

        while (!titleElement && retryCount < maxRetries) {
            console.log(`第 ${retryCount + 1} 次重试查找...`);

            // 继续模拟浏览行为
            await simulateHumanBehavior();
            await humanWait(300, 500);

            titleElement = findTitleElement();
            retryCount++;
        }

        // 第四步: 提取标题文本
        if (titleElement) {
            // 确保元素可见
            titleElement.scrollIntoView({behavior: 'smooth', block: 'center'});
            await humanWait(100, 200);

            // 模拟鼠标悬停
            const mouseOverEvent = new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            titleElement.dispatchEvent(mouseOverEvent);
            await humanWait(100, 200);

            // 获取标题文本
            let titleText = titleElement.textContent.trim();

            // 清理文本（移除多余空格、换行等）
            titleText = titleText.replace(/\s+/g, ' ').replace(/[\r\n]/g, '').trim();

            console.log('📦 商品标题:', titleText);
            return titleText;
        } else {
            console.error('❌ 未能找到商品标题元素');
            // 尝试其他可能的选择器
            const allSpans = document.querySelectorAll('span');
            for (const span of allSpans) {
                const text = span.textContent.trim();
                if (text.length > 10 && text.length < 100) {
                    console.log('可能找到标题:', text.substring(0, 50) + '...');
                }
            }

            return null;
        }
    } catch (error) {
        console.error('❌ 抓取过程中发生错误:', error);
        return null;
    }
};

// 获取商品主图
async function getMainImages() {
    try {
        console.log('🖼️ 开始获取商品主图...');
        await getAllLazyImages.triggerAll();
        const mainImages = new Set();
        // 方法1：通过图片的特定属性查找
        const mainImageElements = document.querySelectorAll('img[role="img"][aria-label="商品大图"]');
        console.log(`通过属性找到 ${mainImageElements.length} 个主图元素`);

        // 提取每个图片的URL
        mainImageElements.forEach((img, index) => {
            // 优先使用src属性，如果没有则使用data-src（懒加载图片）
            let imageUrl = img.src || img.getAttribute('data-src');

            if (imageUrl) {
                console.log(`主图 ${index + 1}:`, {
                    src: img.src,
                    dataSrc: img.getAttribute('data-src'),
                    url: imageUrl
                });

                // 清理URL（去除参数）
                const cleanUrl = cleanImageUrl(imageUrl);
                if (cleanUrl) {
                    mainImages.add(cleanUrl);
                    console.log(`  处理后URL: ${cleanUrl}`);
                }
            } else {
                console.warn(`主图 ${index + 1} 没有找到URL`);
            }
        });

        const totalCount = getTotalImageCount();
        console.log(`页面显示共有 ${totalCount} 张主图`);

        // 验证找到的图片数量 转换为数组并去重
        const result = Array.from(mainImages);
        console.log(`✅ 最终找到 ${result.length} 张商品主图`);

        return result;
    } catch (error) {
        console.error('获取主图失败:', error);
        return [];
    }
}

// 获取描述图片
async function getDescriptionImages() {
    try {
        console.log('正在查找描述图片...');
        await getAllLazyImages.triggerAll();
        const descriptionImages = new Set();
        // 查找可能的描述区域
        const imgSelectors = [
            'img[role="img"][aria-label*="查看图片"]'
        ];

        for (const selector of imgSelectors) {
            const imgs = document.querySelectorAll(selector);
            console.log(`找到 ${imgs.length} 个图片`);

            imgs.forEach((img, index) => {
                if (img && img.src) {
                    const cleanUrl = cleanImageUrl(img.src);
                    if (cleanUrl) descriptionImages.add(cleanUrl);
                    console.log(` 找到第 ${index + 1} 张图片:`, cleanUrl);
                }
            });
        }
        // 转换为数组并去重
        const result = Array.from(descriptionImages);
        console.log(`找到 ${result.length} 张详情图片:`, result);

        return result;
    } catch (error) {
        console.error('获取描述图片失败:', error);
        return [];
    }
}

/**
 * 获取主图图片总数（从分页指示器或data-uniqid属性）
 */
function getTotalImageCount() {
    try {
        // 方法1：从aria-label获取（如：共9张商品图）
        const paginationElements = document.querySelectorAll('div[aria-label*="张商品图"]');
        for (const element of paginationElements) {
            const label = element.getAttribute('aria-label') || '';
            const match = label.match(/共(\d+)张商品图/);
            if (match && match[1]) {
                const count = parseInt(match[1], 10);
                console.log(`从aria-label获取到图片总数: ${count}`);
                return count;
            }
        }

        // 方法2：查找包含"1/9"这种格式的元素
        const ratioElements = document.querySelectorAll('span, div');
        for (const element of ratioElements) {
            const text = element.textContent || '';
            const match = text.match(/(\d+)\/(\d+)/);
            if (match && match[2]) {
                const count = parseInt(match[2], 10);
                console.log(`从分页文本获取到图片总数: ${count}`);
                return count;
            }
        }

        // 方法3：从data-uniqid属性获取最大值
        const uniqidElements = document.querySelectorAll('[data-uniqid]');
        let maxId = 0;
        uniqidElements.forEach(element => {
            const id = parseInt(element.getAttribute('data-uniqid'), 10);
            if (id > maxId) {
                maxId = id;
            }
        });

        if (maxId > 0) {
            console.log(`从data-uniqid获取到图片总数: ${maxId}`);
            return maxId;
        }

        console.log('无法确定图片总数');
        return 0;

    } catch (error) {
        console.error('获取图片总数失败:', error);
        return 0;
    }
}

// 专用的URL清理函数
function cleanImageUrl(url) {
    if (!url || typeof url !== 'string') return '';

    try {
        // 方法1：直接分割（最简单高效）
        const cleanUrl = url.split('?')[0];

        // 可选：验证URL格式
        if (cleanUrl && (cleanUrl.endsWith('.jpg') ||
            cleanUrl.endsWith('.jpeg') ||
            cleanUrl.endsWith('.png') ||
            cleanUrl.endsWith('.webp'))) {
            return cleanUrl;
        }

        // 如果分割后格式不对，返回原URL
        return url;

    } catch (error) {
        console.error('清理图片URL失败:', error, url);
        return url; // 失败时返回原URL
    }
}

function cleanProductUrl(url) {
    try {
        const urlObj = new URL(url);
        // 获取goods_id参数
        const goodsId = urlObj.searchParams.get('goods_id');

        // 验证goods_id是否为纯数字
        if (!goodsId || !/^\d+$/.test(goodsId)) {
            console.warn('goods_id不是纯数字或不存在:', goodsId);
            return url;
        }

        // 构建基础URL
        const baseUrl = `${urlObj.origin}${urlObj.pathname}?goods_id=${goodsId}`;

        return baseUrl;
    } catch (error) {
        console.error('解析URL失败:', error);
        return url;
    }
}

/**
 * 改进的抓取所有SKU信息函数
 */
const grabAllSkuInfoImproved = async () => {
    console.log('🚀 开始抓取商品SKU信息（改进版）...');

    try {
        // 1. 点击"去拼单""发起拼单"按钮
        const buttonClicked = await clickSpecButton();
        if (!buttonClicked) {
            throw new Error('无法点击规格选择按钮');
        }

        // 2. 等待SKU弹窗出现
        const dialog = await waitForSkuDialog();
        if (!dialog) {
            throw new Error('SKU弹窗未出现');
        }

        // 3. 获取初始SKU信息
        const initialSku = getSkuImageAndPrice(dialog);
        console.log('初始SKU:', initialSku);

        // 4. 获取规格分类（尝试通用查找）
        let specifications = getSkuSpecifications(dialog);

        console.log(`找到 ${specifications.length} 个规格分类`);
        specifications.forEach((spec, i) => {
            console.log(`  ${i + 1}. ${spec.key}: ${spec.values.length} 个选项`);
            // 显示当前选中的选项
            const selectedOption = spec.values.find(v => v.isSelected);
            if (selectedOption) {
                console.log(`     当前选中: ${selectedOption.text}`);
            }
        });

        // 5. 使用双重循环遍历
        const allSkus = await traverseAllSkuCombinationsSimple(dialog, specifications);

        // 6. 关闭弹窗
        await closeSkuDialog(dialog);

        // 7. 输出结果
        console.log('🎉 SKU信息抓取完成！');
        console.log(`📊 共找到 ${allSkus.length} 个SKU`);

        // 分组显示结果
        if (specifications.length > 0) {
            const firstSpec = specifications[0].key;
            const secondSpec = specifications[1] ? specifications[1].key : null;

            // 按第一个规格分组
            const grouped = {};
            allSkus.forEach(sku => {
                const firstValue = sku.specifications[0]?.value || '默认';
                if (!grouped[firstValue]) {
                    grouped[firstValue] = [];
                }
                grouped[firstValue].push(sku);
            });

            console.log('\n📋 分组结果:');
            Object.keys(grouped).forEach(key => {
                console.log(`\n${firstSpec}: ${key}`);
                grouped[key].forEach((sku, i) => {
                    const secondValue = sku.specifications[1]?.value || '';
                    console.log(`  ${i + 1}. ${secondSpec}: ${secondValue}, 价格: ¥${sku.price || '未知'},图片：${sku.imageUrl}`);
                });
            });
        } else {
            allSkus.forEach((sku, index) => {
                console.log(`\nSKU ${index + 1}:`);
                console.log(`  规格: ${sku.pathText || '默认'}`);
                console.log(`  价格: ¥${sku.price || '未知'} (${sku.priceText || ''})`);
                console.log(`  图片: ${sku.imageUrl || '未知'} `);
            });
        }

        // // 8. 保存结果到全局变量，方便查看
        // window.lastSkuResult = allSkus;

        return {
            success: true,
            count: allSkus.length,
            skus: allSkus,
            specifications: specifications.map(s => s.key)
        };

    } catch (error) {
        console.error('❌ 抓取SKU信息失败:', error);
        return {
            success: false,
            error: error.message,
            skus: []
        };
    }
};

/**
 * 简化的遍历函数 - 使用双重循环保持状态
 */
const traverseAllSkuCombinationsSimple = async (dialog, specifications) => {
    const allSkus = [];

    if (specifications.length === 0) {
        // 无规格商品
        const skuInfo = getSkuImageAndPrice(dialog);
        allSkus.push({
            ...skuInfo,
            specifications: [],
            pathText: '默认规格'
        });
        return allSkus;
    }
    //因为妙手ERP的导入仅支持2个SKU规格
    if (specifications.length >= 3) {
        console.error("不支持2个规格以上的商品采集!")
        showCollectionError("仅支持2个规格以内的商品采集！因为导入端不支持。")
        return allSkus;
    }

    // 显示规格信息 isDisabled
    console.log(`📊 规格信息:`);
    specifications.forEach((spec, i) => {
        const enabledCount = spec.values.filter(v => !v.isDisabled).length;
        console.log(`  ${i + 1}. ${spec.key}: ${enabledCount} 个可用选项`);
    });

    // 如果有两个规格，使用双重循环
    if (specifications.length === 2) {
        const firstSpec = specifications[0];
        const secondSpec = specifications[1];

        // 获取可用的选项
        const firstOptions = firstSpec.values.filter(v => !v.isDisabled);
        const secondOptions = secondSpec.values.filter(v => !v.isDisabled);

        console.log(`🔢 遍历 ${firstOptions.length} × ${secondOptions.length} = ${firstOptions.length * secondOptions.length} 个组合`);

        // 双重循环：外层循环第一个规格，内层循环第二个规格
        for (let i = 0; i < firstOptions.length; i++) {
            const firstOption = firstOptions[i];

            console.log(`\n=== 处理 ${firstSpec.key}: ${firstOption.text} ===`);

            // 点击第一个规格的选项
            console.log(`选中 ${firstSpec.key}: ${firstOption.text}`);
            const firstClicked = await clickSkuOption(firstOption.element);

            if (!firstClicked) {
                console.error(`无法选中 ${firstSpec.key}: ${firstOption.text}`);
                continue;
            }

            // 等待第一个选项生效
            await humanWait(300, 500);
            // 新增：重置第二个规格为首个可用选项
            const firstAvailableSecondOption = secondSpec.values.find(v => !v.isDisabled);
            if (firstAvailableSecondOption) {
                await clickSkuOption(firstAvailableSecondOption.element);
                await humanWait(200, 300);
            }

            // 获取更新后的第二个规格可用选项（选择第一个规格后，第二个规格的可用选项可能变化）
            const updatedSecondOptions = await getUpdatedSecondOptions(dialog, secondSpec, firstOption);

            // 现在遍历第二个规格的所有选项
            for (let j = 0; j < updatedSecondOptions.length; j++) {
                const secondOption = updatedSecondOptions[j];

                console.log(`\n  组合 ${i * updatedSecondOptions.length + j + 1}/${firstOptions.length * updatedSecondOptions.length}:`);
                console.log(`  点击 ${secondSpec.key}: ${secondOption.text}`);

                // 点击第二个规格的选项
                const secondClicked = await clickSkuOption(secondOption.element);

                if (secondClicked) {
                    // 等待SKU信息更新
                    await humanWait(400, 600);

                    // 获取SKU信息
                    const skuInfo = getSkuImageAndPrice(dialog);

                    // 构建规格路径
                    const path = [
                        {key: firstSpec.key, value: firstOption.text, index: i},
                        {key: secondSpec.key, value: secondOption.text, index: j}
                    ];

                    const skuData = {
                        ...skuInfo,
                        specifications: path,
                        pathText: `${firstSpec.key}: ${firstOption.text} | ${secondSpec.key}: ${secondOption.text}`
                    };

                    allSkus.push(skuData);
                    console.log(`  📝 记录: ${skuData.pathText}`);
                    console.log(`      价格: ${skuData.price ? '¥' + skuData.price : '未知'}`);

                    // 如果不是最后一个选项，等待一下
                    if (j < secondOptions.length - 1) {
                        await humanWait(200, 300);
                    }
                } else {
                    console.error(`  无法选中 ${secondSpec.key}: ${secondOption.text}`);
                }
            }

            // 如果不是第一个规格的最后一个选项，等待一下准备下一个选项
            if (i < firstOptions.length - 1) {
                console.log(`\n  准备切换到 ${firstSpec.key} 的下一个选项...`);
                await humanWait(300, 500);
            }
        }
    } else {
        // 只有一个规格
        const spec = specifications[0];
        const options = spec.values.filter(v => !v.isDisabled);

        for (let i = 0; i < options.length; i++) {
            const option = options[i];

            console.log(`选择 ${spec.key}: ${option.text}`);
            await clickSkuOption(option.element);
            await humanWait(400, 600);

            const skuInfo = getSkuImageAndPrice(dialog);
            const skuData = {
                ...skuInfo,
                specifications: [{key: spec.key, value: option.text, index: i}],
                pathText: `${spec.key}: ${option.text}`
            };

            allSkus.push(skuData);
            console.log(`📝 记录: ${skuData.pathText}`);
        }
    }

    console.log(`\n✅ 遍历完成，共找到 ${allSkus.length} 个SKU`);
    return allSkus;
};

/**
 * 获取更新后的第二个规格选项（选择第一个规格后）
 */
const getUpdatedSecondOptions = async (dialog, secondSpec, firstOption) => {
    console.log(`🔄 获取 ${secondSpec.key} 的更新选项（已选择 ${firstOption.text}）...`);

    // 重新查找第二个规格的选项
    const updatedValues = [];

    // 查找规格容器
    let container = findSpecContainerByKey(dialog, secondSpec.key);
    if (!container && secondSpec.element) {
        container = secondSpec.element.closest('div');
    }

    if (container) {
        const buttons = container.querySelectorAll('div[role="button"]');
        buttons.forEach((button, index) => {
            // 检查是否可用
            const isDisabled = checkIfElementDisabled(button);
            if (!isDisabled) {
                const optionText = button.getAttribute('aria-label') || button.textContent.trim();
                updatedValues.push({
                    element: button,
                    text: optionText,
                    index: index,
                    isDisabled: false
                });
            }
        });
    }

    // 如果没找到新的，返回原始可用的选项
    if (updatedValues.length === 0) {
        return secondSpec.values.filter(v => !v.isDisabled);
    }

    console.log(`  找到 ${updatedValues.length} 个可用选项`);
    return updatedValues;
};

/**
 * 查找规格容器
 */
const findSpecContainerByKey = (dialog, keyText) => {
    // 查找包含keyText的元素
    const keyElements = dialog.querySelectorAll('span, div');
    for (const element of keyElements) {
        if (element.textContent.trim() === keyText) {
            // 向上查找包含按钮的容器
            let container = element.parentElement;
            for (let i = 0; i < 3; i++) {
                if (container) {
                    const buttons = container.querySelectorAll('div[role="button"]');
                    if (buttons.length > 0) {
                        return container;
                    }
                    container = container.parentElement;
                }
            }
        }
    }
    return null;
};


// 准备Excel数据
function prepareExcelData(productList) {
    console.log('📊 准备Excel数据...');

    // 构建Excel工作表数据
    const data = [];

    // 添加表头
    data.push([
        '产品主编号',
        '产品名称',
        '货币类型',
        '产品主图',
        '货源链接',
        '详情图',
        'SKU规格1',
        'SKU规格2',
        'SKU售价',
        'SKU图片',
        'SKU库存'
    ]);

    // 添加数据行
    productList.forEach((product, index) => {
        console.log(`处理商品 ${index + 1}/${productList.length}: ${product.title.substring(0, 30)}...`);

        // 获取SKU信息数组
        const skuList = product.skuInfo || [];
        if (skuList.length == 0) {
            data.push([
                product.id || `商品${index + 1}`,
                product.title || '无标题',
                'CNY',
                product.mainImagesStr || '',
                product.url || '无链接',
                product.descriptionImagesStr || '',
                '',
                '',
                '无价格',
                '无图片',
                '1000'
            ]);
        } else {
            // 每个SKU单独一行
            skuList.forEach((sku, skuIndex) => {
                // 提取规格信息
                const specs = extractSkuSpecifications(sku);

                // 提取价格信息
                const price = extractSkuPrice(sku);

                // 提取图片信息
                const imageUrl = extractSkuImage(sku);

                data.push([
                    product.id || `商品${index + 1}`,
                    product.title || '无标题',
                    'CNY',
                    product.mainImagesStr || '',
                    product.url || '无链接',
                    product.descriptionImagesStr || '',
                    specs.spec1 || '无SKU',
                    specs.spec2 || '无SKU',
                    price || '无价格',
                    imageUrl || '无图片',
                    '1000'
                ]);
            });
        }

    });

    console.log(`Excel数据准备完成，共 ${data.length - 1} 行数据`);
    return data;
}

// 提取SKU规格信息
function extractSkuSpecifications(sku) {
    const result = {
        spec1: '',
        spec2: ''
    };

    try {
        if (!sku || !sku.specifications || !Array.isArray(sku.specifications)) {
            return result;
        }

        const specs = sku.specifications;

        // 提取第一个规格
        if (specs.length > 0) {
            const firstSpec = specs[0];
            if (firstSpec && firstSpec.value) {
                result.spec1 = `${firstSpec.value}`;
            } else if (firstSpec && typeof firstSpec === 'string') {
                result.spec1 = firstSpec;
            } else if (sku.pathText) {
                // 尝试从pathText中提取
                const parts = sku.pathText.split('|');
                if (parts[0]) result.spec1 = parts[0].trim();
            }
        }

        // 提取第二个规格
        if (specs.length > 1) {
            const secondSpec = specs[1];
            if (secondSpec && secondSpec.value) {
                result.spec2 = ` ${secondSpec.value}`;
            } else if (secondSpec && typeof secondSpec === 'string') {
                result.spec2 = secondSpec;
            } else if (sku.pathText) {
                // 尝试从pathText中提取
                const parts = sku.pathText.split('|');
                if (parts[1]) result.spec2 = parts[1].trim();
            }
        }

    } catch (error) {
        console.error('提取SKU规格失败:', error);
    }

    return result;
}

// 提取SKU价格 - 只保留数字部分
function extractSkuPrice(sku) {
    try {
        // 尝试多种可能的字段名
        if (sku.price !== undefined && sku.price !== null) {
            return `${sku.price}`;
        }

        if (sku.priceText) {
            // ✅ 方法1：使用正则表达式去掉"¥"符号
            // 匹配数字（包括小数点和逗号千位分隔符）
            // const priceMatch = sku.priceText.match(/[¥￥]?\s*([\d,.]+)/);
            // if (priceMatch && priceMatch[1]) {
            //     // 去掉逗号千位分隔符，只保留数字和小数点
            //     const cleanPrice = priceMatch[1].replace(/,/g, '');
            //     return cleanPrice;
            // }

            // ✅ 方法2：直接替换所有非数字字符（保留小数点）
            const numericOnly = sku.priceText.replace(/[^\d.]/g, '');
            if (numericOnly && numericOnly !== '') {
                return numericOnly;
            }

            return sku.priceText; // 如果没有数字，返回原值
        }

        // 从文本中提取价格
        if (sku.pathText && sku.pathText.includes('¥')) {
            const match = sku.pathText.match(/¥\s*([\d.]+)/);
            if (match && match[1]) {
                return `${match[1]}`;
            }
        }

        return '无价格';

    } catch (error) {
        console.error('提取SKU价格失败:', error);
        return '价格异常';
    }
}

// 提取SKU图片
function extractSkuImage(sku) {
    try {
        // 尝试多种可能的字段名
        const imageSources = [
            sku.imageUrl,
            sku.image,
            sku.img,
            sku.image_url,
            sku.imgUrl,
            sku.mainImage
        ];

        for (const img of imageSources) {
            if (img && typeof img === 'string' && img.trim()) {
                // 清理图片URL，去除参数
                return cleanImageUrl(img.trim());
            }
        }

        return '无图片';

    } catch (error) {
        console.error('提取SKU图片失败:', error);
        return '图片异常';
    }
}

/**
 * 点击规格选项
 */
const clickSkuOption = async (element) => {
    if (!element) {
        console.error('❌ 元素不存在');
        return false;
    }

    try {
        // 确保元素可见
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 &&
            rect.top >= 0 && rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth;

        if (!isVisible) {
            console.log('滚动到元素位置...');
            element.scrollIntoView({behavior: 'smooth', block: 'center'});
            await humanWait(100, 200);
        }

        // 模拟鼠标悬停
        const mouseOverEvent = new MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        element.dispatchEvent(mouseOverEvent);
        await humanWait(50, 100);

        // 点击前检查是否已经选中
        const beforeClass = element.getAttribute('class') || '';

        const isAlreadySelected = beforeClass.includes('hr353bdX') ||
            beforeClass.includes('selected') ||
            beforeClass.includes('active') ||
            element.getAttribute('aria-checked') === 'true' ||
            (element.getAttribute('aria-label') || '').includes('已选中') ||
            (element.getAttribute('aria-label') || '').includes('当前选择');

        if (isAlreadySelected) {
            console.log('  选项已选中，跳过点击');
            return true;
        }

        // 点击元素
        element.click();

        // 等待SKU信息更新
        await humanWait(200, 400);
        // 检查是否选中
        const afterClass = element.getAttribute('class') || '';

        const isSelected = afterClass.includes('hr353bdX') ||
            afterClass.includes('selected') ||
            afterClass.includes('active') ||
            element.getAttribute('aria-checked') === 'true' ||
            (element.getAttribute('aria-label') || '').includes('已选中') ||
            (element.getAttribute('aria-label') || '').includes('当前选择');

        return isSelected;
    } catch (error) {
        console.error('❌ 点击规格选项时出错:', error);
        return false;
    }
};

/**
 * 点击右下角按钮（排除"单独购买"的按钮）
 */
const clickSpecButton = async () => {
    console.log('🔍 查找右下角规格选择按钮...');

    try {
        // 方法1: 直接查找具有特定背景颜色（鲜红色）的按钮
        const targetButton = findButtonByStyle();

        if (targetButton) {
            return await clickButton(targetButton, '特定背景颜色按钮');
        }

        // 方法2: 查找页面结构中的特定按钮（最下方一行几个按钮）
        const structureButton = findButtonByStructure();

        if (structureButton) {
            return await clickButton(structureButton, '结构定位按钮');
        }

        // 方法3: 备用方案 - 根据文本和位置查找
        const fallbackButton = findButtonByTextAndPosition();

        if (fallbackButton) {
            return await clickButton(fallbackButton, '备用方案按钮');
        }

        console.error('❌ 未能找到规格选择按钮');
        return false;

    } catch (error) {
        console.error('❌ 点击规格按钮时出错:', error);
        return false;
    }
};

/**
 * 方法1: 根据style属性查找按钮
 */
const findButtonByStyle = () => {
    console.log('🔍 方法1: 根据style属性查找...');

    // 查找所有具有背景颜色的按钮
    const allButtons = document.querySelectorAll('div[role="button"]');

    for (const button of allButtons) {
        const style = button.getAttribute('style') || '';

        // 检查是否包含目标背景颜色
        if (style.includes('background-color: rgb(224, 46, 36)') ||
            style.includes('background-color:rgb(224,46,36)') ||
            style.includes('background-color:#e02e24')) {

            console.log('✅ 找到具有特定背景颜色的按钮:', button);
            console.log('按钮文本:', button.textContent?.trim());
            console.log('按钮位置:', button.getBoundingClientRect());

            // 验证按钮是否在右下角区域
            if (isButtonInBottomRightArea(button)) {
                return button;
            }
        }
    }

    // 尝试查找近似颜色
    console.log('尝试查找近似背景颜色的按钮...');
    const colorVariations = [
        'rgb(224, 46, 36)',  // 原色
        'rgb(225, 46, 36)',  // 近似色
        'rgb(224, 47, 36)',  // 近似色
        '#e02e24',           // 十六进制
        'rgba(224, 46, 36',  // rgba格式
    ];

    for (const color of colorVariations) {
        for (const button of allButtons) {
            const style = button.getAttribute('style') || '';
            if (style.toLowerCase().includes(color.toLowerCase())) {
                console.log(`✅ 找到近似颜色 ${color} 的按钮`);
                if (isButtonInBottomRightArea(button)) {
                    return button;
                }
            }
        }
    }

    return null;
};

/**
 * 方法2: 根据页面结构查找按钮
 */
const findButtonByStructure = () => {
    console.log('🔍 方法2: 根据页面结构查找...');

    // 查找包含多个按钮的容器
    const containers = document.querySelectorAll('div');

    for (const container of containers) {
        // 检查容器是否有三个子按钮
        const childButtons = container.querySelectorAll('div[role="button"]');

        if (childButtons.length >= 3) {
            console.log(`找到有 ${childButtons.length} 个按钮的容器`);

            // 寻找第四个兄弟div下的第二个按钮
            const nextSibling = findNextSiblingWithTwoButtons(container);

            if (nextSibling) {
                const buttonsInSibling = nextSibling.querySelectorAll('div[role="button"]');

                if (buttonsInSibling.length >= 2) {
                    const targetButton = buttonsInSibling[1]; // 第二个按钮
                    console.log('✅ 通过结构找到目标按钮');
                    console.log('按钮文本:', targetButton.textContent?.trim());

                    if (isButtonInBottomRightArea(targetButton)) {
                        return targetButton;
                    }
                }
            }
        }
    }

    return null;
};

/**
 * 查找包含两个按钮的兄弟元素
 */
const findNextSiblingWithTwoButtons = (element) => {
    let currentElement = element;

    // 查找下一个兄弟元素
    for (let i = 0; i < 5; i++) {
        currentElement = currentElement.nextElementSibling;
        if (!currentElement) break;

        const buttons = currentElement.querySelectorAll('div[role="button"]');
        if (buttons.length === 2) {
            console.log(`找到第 ${i + 1} 个兄弟元素，包含 ${buttons.length} 个按钮`);
            return currentElement;
        }
    }

    return null;
};

/**
 * 方法3: 根据文本和位置查找按钮（备用方案）
 */
const findButtonByTextAndPosition = () => {
    console.log('🔍 方法3: 根据文本和位置查找...');

    // 常见购买按钮文本
    const purchaseTexts = ['立即购买', '一键拼单', '发起拼单', '参与拼单', '去拼单', '购买'];

    const allButtons = document.querySelectorAll('div[role="button"]');

    for (const button of allButtons) {
        const buttonText = button.textContent?.trim() || '';

        // 检查按钮文本是否匹配购买相关词汇
        for (const text of purchaseTexts) {
            if (buttonText.includes(text) && !buttonText.includes('单独购买')) {
                console.log(`✅ 找到文本匹配的按钮: "${buttonText}"`);

                if (isButtonInBottomRightArea(button)) {
                    return button;
                }
            }
        }
    }

    // 如果文本匹配失败，尝试通过位置查找
    return findButtonByPositionOnly();
};

/**
 * 仅通过位置查找右下角按钮
 */
const findButtonByPositionOnly = () => {
    console.log('🔍 仅通过位置查找右下角按钮...');

    const allButtons = document.querySelectorAll('div[role="button"]');
    let bestCandidate = null;
    let bestScore = 0;

    for (const button of allButtons) {
        if (!button.offsetWidth || !button.offsetHeight) continue;

        const rect = button.getBoundingClientRect();
        const score = calculateButtonPositionScore(rect);

        if (score > bestScore) {
            bestScore = score;
            bestCandidate = button;
        }
    }

    if (bestCandidate) {
        console.log(`✅ 找到右下角按钮，位置得分: ${bestScore}`);
        console.log('按钮文本:', bestCandidate.textContent?.trim());
        return bestCandidate;
    }

    return null;
};

/**
 * 计算按钮位置得分（右下角得分高）
 */
const calculateButtonPositionScore = (rect) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 计算中心点到右下角的距离
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const distanceToRight = Math.abs(centerX - viewportWidth);
    const distanceToBottom = Math.abs(centerY - viewportHeight);

    // 距离右下角越近，得分越高
    const horizontalScore = 1 - (distanceToRight / viewportWidth);
    const verticalScore = 1 - (distanceToBottom / viewportHeight);

    // 大小权重（排除太小的按钮）
    const sizeFactor = Math.min(rect.width * rect.height / 1000, 1);

    return (horizontalScore + verticalScore) * sizeFactor;
};

/**
 * 检查按钮是否在右下角区域
 */
const isButtonInBottomRightArea = (button) => {
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // 定义右下角区域（底部200px，右侧300px）
    const isBottom = rect.bottom > viewportHeight - 200;
    const isRight = rect.right > viewportWidth - 300;

    return isBottom && isRight;
};

/**
 * 点击按钮的通用函数
 */
const clickButton = async (button, methodName) => {

    // 滚动到按钮位置
    button.scrollIntoView({behavior: 'smooth', block: 'center'});
    await humanWait(200, 300);

    // 模拟鼠标移动到按钮上
    const mouseOverEvent = new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true
    });
    button.dispatchEvent(mouseOverEvent);
    await humanWait(100, 200);

    // 模拟点击
    button.click();

    // 等待弹窗出现
    await humanWait(500, 800);
    return true;
};

/**
 * 等待SKU弹窗出现
 */
const waitForSkuDialog = async (maxRetries = 2) => {
    console.log('⏳ 等待SKU选择弹窗出现...');

    for (let i = 0; i < maxRetries; i++) {
        const dialog = document.querySelector('div[role="dialog"][aria-modal="true"]');

        if (dialog) {
            console.log('✅ SKU弹窗已出现');

            // 确保弹窗完全加载
            await humanWait(400, 600);
            return dialog;
        }

        console.log(`等待弹窗... (${i + 1}/${maxRetries})`);
        await humanWait(400, 600);

        // 偶尔滚动一下模拟真实操作
        if (i % 2 === 0) {
            window.scrollBy({top: 50, behavior: 'smooth'});
        }
    }

    console.error('❌ 等待SKU弹窗超时');
    return null;
};

/**
 * 关闭SKU弹窗
 */
const closeSkuDialog = async (dialog) => {
    try {
        console.log('🚪 关闭SKU弹窗...');

        // 查找关闭按钮
        const closeButton = dialog.querySelector('div[role="button"][aria-label*="关闭"]') ||
            dialog.querySelector('button[aria-label*="关闭"]') ||
            dialog.querySelector('div[class*="close"], button[class*="close"]');

        if (closeButton) {
            closeButton.click();
            await humanWait(200, 400);
            console.log('✅ SKU弹窗已关闭');
        } else {
            console.log('⚠️ 未找到关闭按钮，尝试其他方式关闭');

            // 尝试点击弹窗外部或按ESC
            const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });

            // 创建遮罩层点击
            const backdrop = document.querySelector('.modal-backdrop, [class*="mask"], [class*="overlay"]');
            if (backdrop) {
                backdrop.click();
            }

            await humanWait(300, 500);
        }

        return true;
    } catch (error) {
        console.error('❌ 关闭弹窗时出错:', error);
        return false;
    }
};


// 懒加载图片管理器
const getAllLazyImages = {
    observer: null,
    // 触发所有懒加载图片
    triggerAll() {
        return new Promise((resolve) => {
            // 如果已有observer，先断开
            if (this.observer) {
                this.observer.disconnect();
            }

            // 立即触发已存在的懒加载图片
            const lazyImages = document.querySelectorAll('img[data-src]');
            console.log(`找到 ${lazyImages.length} 个懒加载图片`);

            lazyImages.forEach(img => {
                const dataSrc = img.getAttribute('data-src');
                if (dataSrc && !img.src.includes(dataSrc)) {
                    img.src = dataSrc;
                }
            });

            // 设置observer监听新出现的懒加载图片
            this.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeName === 'IMG' && node.hasAttribute('data-src')) {
                            const dataSrc = node.getAttribute('data-src');
                            if (dataSrc && !node.src.includes(dataSrc)) {
                                node.src = dataSrc;
                            }
                        }
                    });
                });
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 轻微滚动触发更多加载
            window.scrollBy({top: 100, behavior: 'smooth'});

            // 500ms后断开observer
            setTimeout(() => {
                if (this.observer) {
                    this.observer.disconnect();
                    this.observer = null;
                }
                resolve();
            }, 500);
        });
    },

    // 清理
    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
};


// 创建Workbook
function createWorkbook(data) {
    console.log('📄 创建Excel文件...');

    // 创建一个二维数组的工作表数据
    const worksheetData = data;

    // 计算列宽
    const colWidths = [];
    for (let col = 0; col < worksheetData[0].length; col++) {
        let maxLength = 0;
        for (let row = 0; row < worksheetData.length; row++) {
            const cellValue = worksheetData[row][col]?.toString() || '';
            maxLength = Math.max(maxLength, cellValue.length);
        }
        // 设置列宽（最小8，最大50）
        colWidths.push(Math.min(Math.max(maxLength + 2, 8), 50));
    }

    // 使用 SheetJS 库创建 Excel 文件
    // 注意：需要先加载 SheetJS 库
    // 这里使用简化版实现，如果需要完整功能，请引入 xlsx.full.min.js

    const sheetName = '商品数据';

    return {
        data: worksheetData,
        colWidths: colWidths,
        sheetName: sheetName
    };
}

// 下载Excel文件
async function downloadExcel(workbook) {
    console.log('💾 下载Excel文件...');
    let format = 'xlsx'; // 默认为xlsx
    try {
        // 优先尝试使用XLSX格式
        await downloadAsXLSX(workbook);
    } catch (error) {
        console.error('XLSX格式失败，回退到CSV:', error);
        format = 'csv'; // 回退为csv
        // 回退到CSV格式
        try {
            await downloadAsCSV(workbook.data);
        } catch (csvError) {
            console.error('CSV格式也失败:', csvError);
            throw new Error('所有导出格式都失败');
        }
    }
    return format;

}

// 新增：全局统一时间戳生成函数
const getExportTimestamp = () => {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
};

// 下载为CSV格式
async function downloadAsCSV(data) {
    return new Promise((resolve, reject) => {
        try {
            // 构建CSV内容
            const csvContent = data.map(row =>
                row.map(cell => {
                    // 处理特殊字符
                    let cellStr = cell?.toString() || '';
                    // 如果包含逗号、换行符或引号，用引号包裹并转义引号
                    if (cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')) {
                        cellStr = '"' + cellStr.replace(/"/g, '""') + '"';
                    }
                    return cellStr;
                }).join(',')
            ).join('\n');

            // 创建Blob - 添加UTF-8 BOM头以解决Excel中文乱码问题
            const bom = '\uFEFF'; // UTF-8 BOM
            const blob = new Blob([bom + csvContent], {
                type: 'text/csv;charset=utf-8'
            });

            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;

            // 生成文件名
            const timestamp = getExportTimestamp();
            const filename = `商品数据_${timestamp}.csv`;
            link.download = filename;

            // 触发下载
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // 释放URL对象
            setTimeout(() => URL.revokeObjectURL(url), 100);

            console.log(`✅ CSV文件已下载: ${filename}`);
            resolve();

        } catch (error) {
            console.error('下载CSV文件失败:', error);
            reject(error);
        }
    });
}

async function downloadAsXLSX(workbook) {
    // 需要先加载SheetJS库
    if (typeof XLSX === 'undefined') {
        console.warn('SheetJS库未加载，使用CSV格式');
        return await downloadAsCSV(workbook.data);
    }

    try {
        // 创建工作簿
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(workbook.data);

        // 设置列宽
        if (workbook.colWidths) {
            ws['!cols'] = workbook.colWidths.map(width => ({wch: width}));
        }

        // 添加到工作簿
        XLSX.utils.book_append_sheet(wb, ws, workbook.sheetName);

        // 生成Excel文件
        const wbout = XLSX.write(wb, {
            bookType: 'xlsx',
            type: 'binary'
        });

        // 转换二进制数据
        const buffer = new ArrayBuffer(wbout.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < wbout.length; i++) {
            view[i] = wbout.charCodeAt(i) & 0xFF;
        }

        // 创建Blob
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        // 下载文件
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = getExportTimestamp();
        link.download = `商品数据_${timestamp}.xlsx`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 100);

        console.log('✅ Excel文件已下载');

    } catch (error) {
        console.error('生成Excel文件失败:', error);
        // 降级到CSV
        await downloadAsCSV(workbook.data);
    }
}

// ✅ 新增：清除本地存储的函数
async function clearLocalStorage() {
    return new Promise((resolve, reject) => {
        console.log('🗑️ 正在清除本地存储数据...');

        chrome.storage.local.remove(['productDataList', 'lastProductData'], () => {
            if (chrome.runtime.lastError) {
                console.error('清除本地存储失败:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('✅ 本地存储已清空');
                resolve();
            }
        });
    });
}
