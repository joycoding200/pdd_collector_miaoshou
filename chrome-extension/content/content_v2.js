// content.js - 修复版

let isExporting = false;
let lastNoDataTime = 0;

(function () {
    'use strict';

    console.log('采集助手 v1.0 - 拼多多商品链接');

    // 配置
    const CONFIG = {
        panelId: 'pdd-collector-panel',
        panelTitle: '多多采集助手',
        panelVersion: '1.0',
        minCollectionInterval: 20000, // 最小采集间隔20秒（单位：毫秒）
        maxCollectionsPerHour: 50,   // 每小时最大采集次数

    };

    // 添加状态锁和防抖变量
    let isCollecting = false;
    let collectionQueue = null;
    // 新增：声明定时器变量，初始为null
    let activationCheckTimer = null;

    // 全局变量区新增
    let urlChangeObserver = null;

    // 激活状态管理
    let activationStatus = {
        isActivated: false,
        expiresAt: null,
        daysRemaining: -1
    };

    // 检查激活状态 应在background中实现

    // 重新定义校验函数，禁止重写/删除
    // Object.defineProperty(window, 'checkActivationStatus', {
    //     value: checkActivationStatus,
    //     writable: false, // 禁止重写
    //     configurable: false, // 禁止删除/修改属性描述
    //     enumerable: false // 不参与枚举，减少被发现的可能
    // });

    // 创建面板HTML
    function createCollectorPanelHTML() {
        return `
     <div class="panel-inner">
        <!-- 左侧标题区域 -->
        <div class="panel-header">
          <svg class="collector-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            <path d="M21 18v2H3v-2h18zM13 3v2H5v2h8v2l4-4-4-4z" opacity="0.8"/>
          </svg>
          <div class="panel-title">
            <span class="title-main">${CONFIG.panelTitle}</span>
            <span class="title-sub" id="activation-status-display">检查激活状态...</span>
          </div>
        </div>
        
        <!-- 右侧操作区域 -->
        <div class="panel-content" id="panel-content-area">
            <div class="panel-actions">
              <button class="collect-btn" id="startCollectBtn">开始采集</button>
              <button class="export-btn" id="exportDataBtn">数据导出</button>
              <button class="close-btn" id="closePanelBtn" title="关闭面板">×</button>
            </div>
        </div>
      </div>
    `;
    }

    function createActivationContainerHTML() {
        return `
         <div style="width:100%;max-width:420px;text-align:center;background:rgba(30,35,45,0.85);border-radius:16px;padding:36px;box-shadow:0 10px 30px rgba(0,0,0,0.4), inset 0 0 20px rgba(255,153,0,0.15);">
        <!-- 钥匙图标 -->
        <div style="width:72px;height:72px;background:linear-gradient(135deg, #ff9900, #ff6600);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;box-shadow:0 4px 15px rgba(255,102,0,0.35);">
            <span style="font-size:36px;font-weight:bold;">🔑</span>
        </div>
        
        <!-- 标题 -->
        <h2 style="font-size:26px;font-weight:700;color:#ffcc66;margin:0 0 12px;letter-spacing:1px;text-shadow:0 0 10px rgba(255,204,102,0.3);">
            插件未激活
        </h2>
        
        <!-- 描述 -->
        <p style="color:#a0a8b8;font-size:16px;line-height:1.6;margin:0 0 30px;padding:0 10px;">
            请输入36位激活码解锁全部商品采集功能<br>
            <span style="color:#ff9900;font-weight:500;display:inline-block;margin-top:8px;letter-spacing:0.5px;">
                ✨ 激活后立即生效 · 无需刷新页面
            </span>
        </p>
        
        <!-- 激活码输入框 -->
        <div style="position:relative;margin-bottom:24px;width:100%;">
            <input type="text" id="panel-activation-code" 
                maxlength="36"
                style="width:100%;padding:16px 20px;font-size:18px;text-align:center;background:rgba(20,25,35,0.9);border:2px solid #3a4255;border-radius:12px;color:#e6e9ff;letter-spacing:2px;outline:none;transition:all 0.3s;font-family:Consolas, Monaco, monospace;">
        </div>
        
        <!-- 激活按钮 -->
        <button id="panel-activate-btn" 
            style="width:100%;padding:16px;background:linear-gradient(135deg, #ff9900, #ff6600);color:white;border:none;border-radius:12px;font-size:19px;font-weight:bold;cursor:pointer;transition:all 0.3s;box-shadow:0 4px 15px rgba(255,102,0,0.35);letter-spacing:1px;">
            🔓 立即激活
        </button>
        
        <!-- 状态消息区 -->
        <div id="activation-msg" style="min-height:28px;margin-top:20px;font-weight:500;font-size:15px;padding:6px 0;"></div>
        
        <!-- 底部提示 -->
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #2a2f3a;color:#6a7285;font-size:14px;line-height:1.5;">
            💡 激活后自动保存设备信息，更换设备需重新激活<br>
        </div>
    </div>
        `;
    }

    // 更新激活状态显示
    function updateActivationDisplay(activationStatus) {
        const statusDisplay = document.getElementById('activation-status-display');
        if (!statusDisplay) return;

        if (activationStatus.isActivated) {
            if (activationStatus.daysRemaining > 30 || activationStatus.daysRemaining < 0) {
                statusDisplay.textContent = activationStatus.daysRemaining < 0 ? '永久有效' : `剩余 ${activationStatus.daysRemaining} 天`;
                statusDisplay.style.color = '#27ae60';
            } else if (activationStatus.daysRemaining <= 30 && activationStatus.daysRemaining > 7) {
                statusDisplay.textContent = `剩余 ${activationStatus.daysRemaining} 天`;
                statusDisplay.style.color = '#f39c12';
            } else if (activationStatus.daysRemaining <= 7 && activationStatus.daysRemaining > 0) {
                statusDisplay.textContent = `即将到期 (${activationStatus.daysRemaining}天)`;
                statusDisplay.style.color = '#e74c3c';
            } else if (activationStatus.daysRemaining === 0) {
                statusDisplay.textContent = '今日到期';
                statusDisplay.style.color = '#e74c3c';
            }

            // 启用按钮
            document.getElementById('startCollectBtn').disabled = false;
            document.getElementById('exportDataBtn').disabled = false;
        } else {
            statusDisplay.textContent = '未激活';
            statusDisplay.style.color = '#e74c3c';

            // 禁用按钮
            document.getElementById('startCollectBtn').disabled = true;
            document.getElementById('exportDataBtn').disabled = true;
        }
    }

    // 注入面板到页面
    async function injectPanel() {
        // 移除可能存在的旧面板
        const existingPanel = document.getElementById(CONFIG.panelId);
        if (existingPanel) {
            // 清理旧面板的事件监听器
            const oldStartBtn = existingPanel.querySelector('#startCollectBtn');
            if (oldStartBtn && oldStartBtn._collectionHandler) {
                oldStartBtn.removeEventListener('click', oldStartBtn._collectionHandler);
            }
            existingPanel.remove();
        }

        // 检查激活状态
        // activationStatus = await checkActivationStatus();
        const status = await new Promise((resolve) => {
            chrome.runtime.sendMessage({action: 'getActivationStatus'}, (response) => {
                resolve(response);
            });
        });
        activationStatus = {
            isActivated: status.isActivated,
            expiresAt: status.expiresAt,
            daysRemaining: status.daysUntilExpiration
        };

        // 创建面板元素
        const panel = document.createElement('div');
        panel.id = CONFIG.panelId;
        panel.innerHTML = createCollectorPanelHTML();


        const activationContainer = document.createElement('div');
        activationContainer.id = 'pdd-activation-container';
        activationContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #1a1f2e 0%, #0f1217 100%);
            border-radius: 12px;
            padding: 36px 24px;
            box-sizing: border-box;
            z-index: 2147483646; /* 关键修复：比面板高1 */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden; /* 关键修复：避免滚动条 */
            pointer-events: all; /* 确保能点击 */
            transition: opacity 0.3s;
            opacity: 0;
            visibility: hidden;
            `;
        activationContainer.innerHTML = createActivationContainerHTML();

        panel.appendChild(activationContainer);

        // 根据激活状态显示/隐藏内容
        if (status?.isActivated) {
            // 已激活：隐藏激活容器，显示功能区域
            activationContainer.style.display = 'none';
            const contentArea = panel.querySelector('#panel-content-area');
            if (contentArea) {
                contentArea.style.display = 'block';
            }
            panel.classList.add('activated');
        } else {
            // 未激活：显示激活容器，隐藏功能区域
            activationContainer.style.display = 'flex';
            const contentArea = panel.querySelector('#panel-content-area');
            if (contentArea) {
                contentArea.style.display = 'none';
            }
            panel.classList.remove('activated');

            // 聚焦输入框
            setTimeout(() => {
                const input = activationContainer.querySelector('#panel-activation-code');
                if (input) {
                    input.focus();
                    // 确保输入框可用
                    input.removeAttribute('readonly');
                    input.removeAttribute('disabled');
                }
            }, 300);
        }


        // 注入到页面
        document.body.appendChild(panel);
        console.log('采集助手面板已注入');


        // 更新激活状态显示
        updateActivationDisplay(activationStatus);

        // 绑定事件
        bindPanelEvents(panel);


        // 定时重检：每30秒向后端验证一次激活状态
        activationCheckTimer = setInterval(async () => {
            if (document.hidden) return; // 页面隐藏时跳过，减少请求
            // const newStatus = await checkActivationStatus();
            const newStatus = await new Promise((resolve) => {
                chrome.runtime.sendMessage({action: 'getActivationStatus'}, (response) => {
                    resolve(response);
                });
            });

            // 状态变化时更新UI
            if (newStatus.isActivated !== activationStatus.isActivated) {
                activationStatus = Object.freeze(newStatus); // 重新冻结
                updateActivationDisplay(activationStatus);
            }
        }, 30000);

        // 页面切回时重检（如用户从其他标签切回）
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                // const newStatus = await checkActivationStatus();
                const newStatus = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({action: 'getActivationStatus'}, (response) => {
                        resolve(response);
                    });
                });

                activationStatus = Object.freeze(newStatus);
                updateActivationDisplay(activationStatus);
            }
        });

        return panel;
    }

    // 显示激活容器的函数
    function showActivationContainer() {
        const panel = document.getElementById(CONFIG.panelId);
        const activationContainer = document.getElementById('pdd-activation-container');
        const contentArea = document.getElementById('panel-content-area');

        if (panel && activationContainer && contentArea) {
            activationContainer.style.display = 'flex';
            contentArea.style.display = 'none';
            panel.classList.remove('activated');

            // 聚焦输入框
            setTimeout(() => {
                const input = activationContainer.querySelector('#panel-activation-code');
                if (input) input.focus();
            }, 100);
        }
    }

    // 绑定面板事件
    function bindPanelEvents(panel) {
        // 开始采集按钮
        const startBtn = panel.querySelector('#startCollectBtn');
        if (startBtn) {
            // 创建新的处理函数
            const handleStartCollection = function (e) {
                e.stopPropagation();
                e.preventDefault();
                // 检查激活状态
                if (!activationStatus.isActivated) {
                    showActivationRequiredNotification();
                    return;
                }
                startCollection();
            };

            // 移除可能已存在的事件监听器
            startBtn.removeEventListener('click', handleStartCollection);

            // 绑定事件
            startBtn.addEventListener('click', handleStartCollection);

            // 保存引用以便后续移除
            startBtn._collectionHandler = handleStartCollection;
        }

        // 新增：导出数据按钮
        const exportBtn = panel.querySelector('#exportDataBtn');
        if (exportBtn) {
            const handleExportData = async function (e) {
                e.stopPropagation();
                e.preventDefault();

                // 检查激活状态
                if (!activationStatus.isActivated) {
                    showActivationRequiredNotification();
                    return;
                }

                // 显示加载状态
                exportBtn.classList.add('loading');
                exportBtn.disabled = true;
                exportBtn.textContent = '';

                try {
                    await exportDataToExcel();
                } catch (error) {
                    // 这里只处理真正的错误（如文件写入失败等）
                    console.error('导出失败:', error);
                    showExportError(error.message);
                } finally {
                    // 恢复按钮状态
                    exportBtn.classList.remove('loading');
                    exportBtn.disabled = false;
                    exportBtn.textContent = '数据导出';
                }
            };

            exportBtn.addEventListener('click', handleExportData);
            exportBtn._exportHandler = handleExportData;
        }

        // 关闭按钮
        const closeBtn = panel.querySelector('#closePanelBtn');
        if (closeBtn) {
            const handleClosePanel = function (e) {
                e.stopPropagation();
                panel.style.display = 'none';
                // addReopenButton();
            };

            // 移除之前的监听器
            closeBtn.removeEventListener('click', handleClosePanel);

            // 绑定新的事件监听器
            closeBtn.addEventListener('click', handleClosePanel);

            // 保存引用
            closeBtn._closeHandler = handleClosePanel;
        }

        // 激活按钮
        // document.getElementById('panel-activate-btn')?.addEventListener('click', handleActivation);
        const activateBtn = panel.querySelector('#panel-activate-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', handleActivation);
        }
        // 激活码输入框事件绑定
        const activationInput = panel.querySelector('#panel-activation-code');
        if (activationInput) {
            // 移除之前可能绑定的事件
            activationInput.removeEventListener('keypress', handleActivationKeyPress);
            activationInput.removeEventListener('input', formatActivationCode);
            activationInput.removeEventListener('focus', handleActivationInputFocus);
            activationInput.removeEventListener('blur', handleActivationInputBlur);

            // 绑定新事件
            activationInput.addEventListener('keypress', handleActivationKeyPress);
            activationInput.addEventListener('input', formatActivationCode);
            activationInput.addEventListener('focus', handleActivationInputFocus);
            activationInput.addEventListener('blur', handleActivationInputBlur);
        }
    }

    // 激活码输入框按键事件
    function handleActivationKeyPress(e) {
        if (e.key === 'Enter') {
            handleActivation();
        }
    }

    // 激活码输入框格式化
    function formatActivationCode(e) {
        let value = e.target.value;

        // 转换为小写（UUID通常用小写）
        value = value.toLowerCase();

        // 只保留字母a-f、数字0-9和连字符
        value = value.replace(/[^0-9a-f-]/g, '');

        // 自动添加连字符（保持8-4-4-4-12格式）
        let parts = value.split('-');
        let cleanValue = '';

        for (let i = 0; i < parts.length; i++) {
            if (i > 0) cleanValue += '-';

            // 限制每部分的长度
            if (i === 0 && parts[i].length > 8) {
                parts[i] = parts[i].substring(0, 8);
            } else if (i === 1 && parts[i].length > 4) {
                parts[i] = parts[i].substring(0, 4);
            } else if (i === 2 && parts[i].length > 4) {
                parts[i] = parts[i].substring(0, 4);
            } else if (i === 3 && parts[i].length > 4) {
                parts[i] = parts[i].substring(0, 4);
            } else if (i === 4 && parts[i].length > 12) {
                parts[i] = parts[i].substring(0, 12);
            }

            cleanValue += parts[i];
        }

        // 如果没有连字符，尝试自动分段
        if (!cleanValue.includes('-') && cleanValue.length >= 8) {
            const segments = [
                cleanValue.substring(0, 8),
                cleanValue.substring(8, 12),
                cleanValue.substring(12, 16),
                cleanValue.substring(16, 20),
                cleanValue.substring(20, 32)
            ];
            cleanValue = segments.join('-').replace(/-+$/, '');
        }

        // 限制总长度（36个字符）
        if (cleanValue.length > 36) {
            cleanValue = cleanValue.substring(0, 36);
        }

        e.target.value = cleanValue;
    }

    // 激活码输入框获取焦点
    function handleActivationInputFocus(e) {
        e.target.style.borderColor = '#ff9900';
        e.target.style.boxShadow = '0 0 0 3px rgba(255,153,0,0.2)';
    }

    // 激活码输入框失去焦点
    function handleActivationInputBlur(e) {
        e.target.style.borderColor = '#3a4255';
        e.target.style.boxShadow = 'none';
    }


    // 显示激活要求通知
    function showActivationRequiredNotification() {
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
      <small>请先激活插件才能使用采集功能</small>
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

    // 激活处理函数
    async function handleActivation() {
        const codeInput = document.getElementById('panel-activation-code');
        const msgEl = document.getElementById('activation-msg');
        const code = codeInput.value.trim();

        if (!code || code.length !== 36) {
            showActivationMsg('请输入36位有效激活码', 'error');
            codeInput.focus();
            return;
        }

        // 禁用按钮防重复提交
        const btn = document.getElementById('panel-activate-btn');
        btn.disabled = true;
        btn.innerHTML = '激活中...';
        showActivationMsg('正在验证激活码，请稍候...', 'info');

        let timeoutId;
        let hasResponded = false;
        console.log('chrome.runtime.sendMessage:');
        // 创建Promise包装chrome.runtime.sendMessage
        const sendMessagePromise = new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({action: 'activate', licenseKey: code}, (response) => {
                hasResponded = true;
                if (timeoutId) clearTimeout(timeoutId);

                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        // 设置超时
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                if (!hasResponded) {
                    reject(new Error('激活请求超时，请检查网络或稍后重试'));
                }
            }, 3000); // 3秒超时
        });


        try {
            // 等待消息或超时
            const response = await Promise.race([sendMessagePromise, timeoutPromise]);

            console.log('收到响应:', response);

            // chrome.runtime.sendMessage({action: 'activate', licenseKey: code}, (response) => {
            //     console.log('收到响应:', response);  // 添加调试日志
            //     console.log('扩展错误:', chrome.runtime.lastError);  // 添加调试日志
            //
            //     clearTimeout(timeoutId);
            //     //恢复按钮
            //     btn.disabled = false;
            //     btn.innerHTML = '立即激活';
            //     if (chrome.runtime.lastError) {
            //         console.error('扩展API错误:', chrome.runtime.lastError);
            //         throw new Error(chrome.runtime.lastError.message);
            //     }
            if (response?.success) {
                // 更新本地激活状态
                activationStatus = {
                    isActivated: true,
                    expiresAt: response.expiresAt,
                    daysRemaining: response.daysUntilExpiration
                };
                // 激活成功：隐藏激活容器，显示功能界面
                const panel = document.getElementById(CONFIG.panelId);
                const activationContainer = document.getElementById('pdd-activation-container');
                const contentArea = document.getElementById('panel-content-area');

                if (panel) {
                    panel.classList.add('activated');
                }
                if (activationContainer) {
                    activationContainer.style.display = 'none';
                    activationContainer.style.visibility = 'hidden';
                    activationContainer.style.opacity = '0';
                }
                if (contentArea) {
                    contentArea.style.display = 'block';
                    contentArea.style.visibility = 'visible';
                    contentArea.style.opacity = '1';
                }
                // 更新激活状态显示
                updateActivationDisplay(activationStatus);

                // 重要：立即更新本地激活状态（无需刷新页面！）
                // await refreshPluginStatus();
                // 启用按钮
                document.getElementById('startCollectBtn').disabled = false;
                document.getElementById('exportDataBtn').disabled = false;
                showActivationMsg('✅ 激活成功！功能已解锁', 'success');
                // 3秒后自动清除提示
                setTimeout(() => showActivationMsg(''), 3000);
            } else {
                showActivationMsg(`❌ ${response?.message || '激活失败'}`, 'error');
                codeInput.select();
            }


            //     }
            // )
            //     ;
            //
            //
        } catch (error) {
            console.error('激活请求异常:', error);
            showActivationMsg('网络错误，请检查连接后重试', 'error');
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            btn.disabled = false;
            btn.innerHTML = '立即激活';
        }
    }

    // 消息显示辅助函数
    function showActivationMsg(text, type = '') {
        const el = document.getElementById('activation-msg');
        el.textContent = text;
        el.style.color =
            type === 'success' ? '#27ae60' :
                type === 'error' ? '#e74c3c' :
                    type === 'info' ? '#3498db' : '#7f8c8d';
    }

    // 激活成功后刷新插件状态（关键！）
    async function refreshPluginStatus() {
        const status = await new Promise(resolve =>
            chrome.runtime.sendMessage({action: 'getActivationStatus'}, resolve)
        );

        const panel = document.getElementById(CONFIG.panelId);
        const activationContainer = document.getElementById('pdd-activation-container');
        const contentArea = document.getElementById('panel-content-area');

        if (status?.isActivated) {
            // 隐藏激活容器，显示功能区域
            if (activationContainer) {
                activationContainer.style.display = 'none';
            }
            if (contentArea) {
                contentArea.style.display = 'block';
            }
            if (panel) {
                panel.classList.add('activated');
            }
            // 更新面板状态：启用按钮、移除禁用提示等
            updateActivationDisplay(status);

        }
    }


    // 开始采集数据（主函数）
    async function startCollection() {
        // 检查激活状态
        if (!activationStatus.isActivated) {
            showActivationRequiredNotification();
            return;
        }

        // 如果正在采集，忽略后续点击
        if (isCollecting) {
            console.log('采集正在进行中，请稍候...');
            return;
        }

        // 如果队列中有等待的采集请求，取消它
        if (collectionQueue) {
            clearTimeout(collectionQueue);
            collectionQueue = null;
        }

        // 添加防抖处理：300ms内再次点击会被忽略
        collectionQueue = setTimeout(async () => {
            try {
                isCollecting = true;
                updateCollectButtonState(true); // 禁用按钮并显示采集中状态

                console.log('开始采集商品数据...');

                console.log('模拟人工浏览行为...');
                await simulateHumanBehavior();
                // 1. 抓取商品标题
                const title = await grabProductTitle();

                // 2. 获取商品主图
                const mainImages = await getMainImages();
                const mainImagesStr = mainImages.join(",")

                console.log('模拟人工浏览行为...');
                await simulateHumanBehavior();

                // 3. 获取描述图片
                const descriptionImages = await getDescriptionImages();
                const descriptionImagesStr = descriptionImages.join(",");

                console.log('模拟人工浏览行为...');
                await simulateHumanBehavior();

                // 4. 抓取SKU信息
                const skuResult = await grabAllSkuInfoImproved();

                // 构建完整的数据对象
                const productData = {
                    title: title || '未找到商品标题',
                    skuInfo: skuResult.skus || [],
                    mainImages: mainImages,          // 数组格式
                    mainImagesStr: mainImagesStr,    // 字符串格式，逗号分隔
                    descriptionImages: descriptionImages,          // 数组格式
                    descriptionImagesStr: descriptionImagesStr,    // 字符串格式，逗号分隔
                    url: cleanProductUrl(window.location.href),
                    collectedAt: new Date().toISOString()
                };

                console.log('📊 采集结果统计:');
                console.log(`- 商品标题: ${productData.title}`);
                console.log(`- SKU数量: ${productData.skuInfo.length}`);
                console.log(`- 主图数量: ${productData.mainImages.length}`);
                console.log(`- 详情图数量: ${productData.descriptionImages.length}`);
                console.log(`- 主图列表: ${productData.mainImagesStr}`);
                console.log(`- 详情图列表: ${productData.descriptionImagesStr}`);

                // 显示采集成功提示
                showCollectionSuccess(productData);

                // 这里可以添加处理数据的逻辑，比如：
                // 1. 发送到后台服务器
                // 2. 保存到本地存储
                saveProductData(productData);

                return productData;

            } catch (error) {
                console.error('采集失败:', error);
                showCollectionError(error.message);
                return null;
            } finally {
                // 无论成功失败，都要释放锁
                isCollecting = false;
                updateCollectButtonState(false); // 恢复按钮状态
                collectionQueue = null;
            }
        }, 300); // 防抖延迟300ms
    }

    // 保存商品数据（支持多商品）
    async function saveProductData(productData) {
        return new Promise((resolve, reject) => {
            try {
                // 为当前商品生成唯一ID
                const productId = generateProductId(productData);
                productData.id = productId;

                // 获取已存储的所有商品
                chrome.storage.local.get(['productDataList'], (result) => {
                    let productList = result.productDataList || [];

                    // 检查是否已存在相同商品（基于URL或标题去重）
                    const existingIndex = productList.findIndex(item =>
                        item.url === productData.url ||
                        (item.title === productData.title && item.url === productData.url)
                    );

                    if (existingIndex !== -1) {
                        // 更新已有商品
                        productList[existingIndex] = {
                            ...productList[existingIndex],
                            ...productData, // 合并新数据
                            updatedAt: new Date().toISOString(),
                            collectionCount: (productList[existingIndex].collectionCount || 1) + 1
                        };
                        console.log('更新已有商品数据');
                    } else {
                        // 添加新商品
                        productData.collectionCount = 1;
                        productList.unshift(productData); // 新商品放在最前面
                        console.log('添加新商品数据');
                    }

                    if (productList.length > 90) {
                        // 新增：前端提示用户
                        const notification = document.createElement('div');
                        notification.style.cssText = `/* 复用showNoDataNotification的样式，修改背景色为#e74c3c */`;
                        notification.innerHTML = `⚠️ 存储即将满额<br/><small>当前已采集${productList.length}个商品，满100条将删除最早数据，请及时导出</small>`;
                        document.body.appendChild(notification);
                        // 新增：定时移除提示
                        setTimeout(() => notification.remove(), 8000);

                    }
                    // 限制存储数量（例如最多100个商品）
                    if (productList.length > 100) {
                        productList = productList.slice(0, 100);
                        console.log('商品列表已达上限，删除最早的商品');
                    }

                    // 保存更新后的列表
                    chrome.storage.local.set({
                        'productDataList': productList,
                        'lastProductData': productData // 仍保留最后采集的商品
                    }, () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            console.log(`商品数据已保存，当前共 ${productList.length} 个商品`);
                            resolve({
                                success: true,
                                count: productList.length,
                                isNew: existingIndex === -1,
                                productId: productId
                            });

                        }
                    });
                });
            } catch (error) {
                console.error('保存数据失败:', error);
                reject(error);
            }
        });
    }

    // 生成商品唯一ID
    function generateProductId(productData) {
        // 使用goods_id
        const goods_id = extractGoodsIdFromUrl(productData.url);
        return `pdd_${goods_id}`;
    }

    function extractGoodsIdFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const goodsId = urlObj.searchParams.get('goods_id');
            return goodsId && /^\d+$/.test(goodsId) ? goodsId : null;
        } catch (error) {
            console.error('提取goods_id失败:', error);
            return null;
        }
    }


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

    // 显示采集成功提示
    function showCollectionSuccess(data) {
        // 移除可能存在的旧提示
        const oldNotification = document.querySelector('.collect-success-toast');
        if (oldNotification) oldNotification.remove();

        // 创建提示
        const notification = document.createElement('div');
        notification.className = 'collect-success-toast';
        notification.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <div>
        <div style="font-weight: 600;">采集成功！</div>
        <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">
          ${data.title.substring(0, 35)}${data.title.length > 35 ? '...' : ''}
          ${data.skuInfo.length > 0 ? `<br>共 ${data.skuInfo.length} 个SKU` : ''}
        </div>
      </div>
    `;

        document.body.appendChild(notification);

        // 5秒后自动消失
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

    // 添加导出数据到Excel的功能
    async function exportDataToExcel() {
        console.log('📤 开始导出数据到Excel...');

        // 防止重复执行
        if (isExporting) {
            console.log('导出正在进行中，请稍候...');
            return Promise.resolve();
        }

        isExporting = true;

        // Check if activated
        if (!activationStatus.isActivated) {
            showActivationRequiredNotification();
            return;
        }

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

    // 日期格式化函数
    function formatDate(dateString) {
        if (!dateString) return '';

        try {
            const date = new Date(dateString);
            return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).replace(/\//g, '-');
        } catch (error) {
            return dateString;
        }
    }

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

        const sheetName = encodeURIComponent('拼多多商品数据').replace(/%/g, '');

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

                // 创建Blob
                // const blob = new Blob(['\ufeff' + csvContent], {
                //     type: 'text/csv;charset=utf-8'
                // });

                // 创建Blob - 这次尝试不使用BOM
                const blob = new Blob([csvContent], {
                    type: 'text/csv;charset=utf-8'
                });

                // 创建下载链接
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;

                // 生成文件名
                const timestamp = getExportTimestamp();
                const filename = `拼多多商品数据_${timestamp}.csv`;
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
            link.download = `拼多多商品数据_${timestamp}.xlsx`;

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

    // 显示无数据提示
    function showNoDataNotification() {
        // 移除可能存在的旧提示
        const existingNotification = document.querySelector('.export-no-data-toast');
        if (existingNotification) {
            // 如果有旧的提示，先移除
            existingNotification.remove();
        }

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
        display: flex;
        align-items: center;
        gap: 12px;
    `;

        notification.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#333">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
        <div>
            <div style="font-weight: 600; margin-bottom: 4px;">暂无数据</div>
            <div style="font-size: 12px; opacity: 0.9;">
                请先点击"开始采集"按钮采集商品数据
            </div>
        </div>
    `;

        // 移除可能存在的旧提示
        removeExistingNotifications();

        document.body.appendChild(notification);

        // 5秒后自动消失
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
        border: 1px solid rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        gap: 12px;
    `;

        notification.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        <div>
            <div style="font-weight: 600; margin-bottom: 4px;">正在导出数据...</div>
            <div style="font-size: 12px; opacity: 0.9;">
                共 ${count} 个商品数据，请稍候
            </div>
        </div>
    `;

        // 移除可能存在的旧提示
        removeExistingNotifications();

        document.body.appendChild(notification);

        // 保存引用，以便后续移除
        window.currentExportNotification = notification;
    }

    // 显示导出成功提示
    function showExportSuccess(count, format = 'xlsx') {
        // 移除开始导出提示
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
        border: 1px solid rgba(255, 255, 255, 0.15);
        display: flex;
        align-items: center;
        gap: 10px;
    `;
        const suffix = format === 'xlsx' ? 'xlsx' : 'csv';
        // 获取当前时间戳用于文件名
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        notification.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <div>
            <div style="font-weight: 600;">导出成功！</div>
            <div style="font-size: 12px; opacity: 0.9;">
                已导出 ${count} 个商品数据<br>
                文件名: 拼多多商品数据_${timestamp}.${suffix}
            </div>
        </div>
    `;

        document.body.appendChild(notification);

        // 5秒后自动消失
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

    // 辅助函数：移除现有通知
    function removeExistingNotifications() {
        const notifications = document.querySelectorAll(
            '.export-no-data-toast, .export-start-toast, .export-success-toast, .data-statistics-toast'
        );

        notifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });

        // 清除引用的通知
        if (window.currentExportNotification) {
            if (window.currentExportNotification.parentNode) {
                window.currentExportNotification.parentNode.removeChild(window.currentExportNotification);
            }
            window.currentExportNotification = null;
        }
    }

    function addPanelStyles() {
        const styleId = 'pdd-collector-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
        
        #${CONFIG.panelId} {
            position: fixed !important;
            top: 80px !important;
            right: 20px !important;
            width: 400px !important; /* 增加宽度以容纳激活内容 */
            min-height: 500px !important; /* 增加最小高度 */
            background: rgba(25, 30, 40, 0.95) !important;
            backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(255, 153, 0, 0.3) !important;
            border-radius: 12px !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
            z-index: 2147483645 !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: visible !important; /* 改为visible */
            color: #ffffff !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        }
        
        .panel-inner {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            position: relative !important;
            width: 100% !important;
            height: 100% !important;
        }
        
        /* 激活容器强制样式 */
        #pdd-activation-container {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: linear-gradient(135deg, #1a1f2e 0%, #0f1217 100%) !important;
            border-radius: 12px !important;
            z-index: 2147483646 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 20px !important;
            color: #ffffff !important;
            padding: 20px !important;
            box-sizing: border-box !important;
            overflow: visible !important; /* 改为visible */
            opacity: 1 !important; /* 直接设为可见 */
            visibility: visible !important; /* 直接设为可见 */
            color: #ffffff !important;
        }
        
        /* 激活容器内部内容样式 */
        #pdd-activation-container div {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        
        #pdd-activation-container h2 {
            color: #ffcc66 !important;
            font-size: 26px !important;
            font-weight: 700 !important;
            margin: 0 0 12px !important;
            letter-spacing: 1px !important;
            text-shadow: 0 0 10px rgba(255,204,102,0.3) !important;
            display: block !important;
            visibility: visible !important;
        }
        
        #pdd-activation-container p {
            color: #a0a8b8 !important;
            font-size: 16px !important;
            line-height: 1.6 !important;
            margin: 0 0 30px !important;
            display: block !important;
            visibility: visible !important;
        }
        
        #panel-activation-code {
            color: #ffffff !important;
            background: rgba(255, 255, 255, 0.1) !important;
            border: 2px solid #3a4255 !important;
            font-family: Consolas, Monaco, monospace !important;
            display: block !important;
            visibility: visible !important;
        }
        
        #panel-activation-code:focus {
            border-color: #ff9900 !important;
            box-shadow: 0 0 0 3px rgba(255, 153, 0, 0.2) !important;
        }
        
        #panel-activate-btn {
            background: linear-gradient(135deg, #ff9900, #ff6600) !important;
            color: white !important;
            border: none !important;
            display: block !important;
            visibility: visible !important;
        }
        
        /* 按钮基础样式 */
        #${CONFIG.panelId} button {
            cursor: pointer !important;
            padding: 10px 16px !important;
            border-radius: 6px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            transition: all 0.2s !important;
            border: none !important;
        }
        
        .collect-btn {
            background: linear-gradient(135deg, #ff9900, #ff6600) !important;
            color: white !important;
        }
        
        .export-btn {
            background: rgba(52, 152, 219, 0.9) !important;
            color: white !important;
        }
        
        .close-btn {
            background: rgba(255, 255, 255, 0.1) !important;
            color: #a0a8b8 !important;
            width: 32px !important;
            height: 32px !important;
            border-radius: 50% !important;
            font-size: 20px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        
        /* 确保面板内容区域默认隐藏 */
        #panel-content-area {
            display: none !important;
        }
        
        /* 当激活后显示功能区域 */
        .activated #panel-content-area {
            display: flex !important;
        }
        
    `;

        document.head.appendChild(style);
    }

    // 初始化函数
    function init() {
        console.log('初始化采集助手...');
        // 添加样式
        addPanelStyles();

        // 清理之前的组件
        cleanup();
        getAllLazyImages.cleanup();

        let isUpdatingStorage = false;

        // 监听本地激活数据篡改，立即重新校验
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (isUpdatingStorage) return;  // 防止循环

            if (areaName === 'local' && changes.activationData) {
                // 检查是否是lastVerified字段的变化（如果是，忽略）
                const oldData = changes.activationData.oldValue;
                const newData = changes.activationData.newValue;
                if (oldData && newData &&
                    JSON.stringify({...oldData, lastVerified: null}) ===
                    JSON.stringify({...newData, lastVerified: null})) {
                    // 只有lastVerified变化，不重新验证
                    isUpdatingStorage = false;
                    return;
                }
                console.warn('检测到激活数据被修改，立即重新验证');
                const newStatus = new Promise((resolve) => {
                    chrome.runtime.sendMessage({action: 'getActivationStatus'}, (response) => {
                        resolve(response);
                    });
                });
                activationStatus = Object.freeze(newStatus);
                updateActivationDisplay(activationStatus);
                setTimeout(() => {
                    isUpdatingStorage = false;
                }, 100);
            }
        });

        injectPanel();

        // 设置自动检测
        setupAutoDetection();
    }

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

    // 模拟鼠标移动和滚动行为
    const simulateHumanBehavior = async () => {
        // 随机滚动页面
        const scrollAmount = Math.floor(Math.random() * 300) + 100;
        window.scrollBy({
            top: scrollAmount,
            behavior: 'smooth'
        });

        await humanWait(800, 1500);

        // 轻微回滚，模拟真实浏览
        window.scrollBy({
            top: -scrollAmount / 3,
            behavior: 'smooth'
        });

        await humanWait(500, 1000);
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
                await humanWait(800, 1200);

                titleElement = findTitleElement();
                retryCount++;
            }

            // 第四步: 提取标题文本
            if (titleElement) {
                // 确保元素可见
                titleElement.scrollIntoView({behavior: 'smooth', block: 'center'});
                await humanWait(300, 600);

                // 模拟鼠标悬停
                const mouseOverEvent = new MouseEvent('mouseover', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                titleElement.dispatchEvent(mouseOverEvent);
                await humanWait(200, 400);

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

    // 辅助函数：获取元素的CSS路径
    const getElementPath = (element) => {
        if (!element) return '';

        const path = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.nodeName.toLowerCase();

            if (element.id) {
                selector += `#${element.id}`;
                path.unshift(selector);
                break;
            } else {
                let sibling = element;
                let siblingIndex = 1;

                while (sibling.previousElementSibling) {
                    sibling = sibling.previousElementSibling;
                    siblingIndex++;
                }

                selector += `:nth-child(${siblingIndex})`;
            }

            path.unshift(selector);
            element = element.parentNode;
        }

        return path.join(' > ');
    };

    // 更新采集按钮状态
    function updateCollectButtonState(isCollecting) {
        const startBtn = document.querySelector('#startCollectBtn');
        if (!startBtn) return;

        if (isCollecting) {
            // 采集中的状态
            startBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <circle cx="12" cy="12" r="10" stroke="white" stroke-width="4" fill="none">
                    <animate attributeName="stroke-dasharray" values="1,200;89,200;89,200" dur="1.5s" repeatCount="indefinite"/>
                    <animateTransform attributeName="transform" type="rotate" values="0 12 12;180 12 12;360 12 12" dur="1.5s" repeatCount="indefinite"/>
                </circle>
            </svg>
            采集中...
        `;
            startBtn.disabled = true;
            startBtn.style.opacity = '0.7';
            startBtn.style.cursor = 'not-allowed';
            startBtn.style.display = 'flex';
            startBtn.style.alignItems = 'center';
            startBtn.style.justifyContent = 'center';
            startBtn.style.gap = '8px';
        } else {
            // 恢复正常状态
            startBtn.innerHTML = '开始采集';
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.style.cursor = 'pointer';
            startBtn.style.display = 'inline-block';
        }
    }

    // 主抓取SKU函数
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
                await humanWait(800, 1200);
                // 新增：重置第二个规格为首个可用选项
                const firstAvailableSecondOption = secondSpec.values.find(v => !v.isDisabled);
                if (firstAvailableSecondOption) {
                    await clickSkuOption(firstAvailableSecondOption.element);
                    await humanWait(500, 800);
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
                        await humanWait(1000, 1500);

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
                            await humanWait(500, 800);
                        }
                    } else {
                        console.error(`  无法选中 ${secondSpec.key}: ${secondOption.text}`);
                    }
                }

                // 如果不是第一个规格的最后一个选项，等待一下准备下一个选项
                if (i < firstOptions.length - 1) {
                    console.log(`\n  准备切换到 ${firstSpec.key} 的下一个选项...`);
                    await humanWait(800, 1200);
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
                await humanWait(800, 1200);

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

    // 处理任意数量规格的版本
    const traverseAllSkuCombinationsDynamic = async (dialog, specifications) => {
        const allSkus = [];
        const indices = new Array(specifications.length).fill(0);

        while (true) {
            // 点击当前组合
            for (let i = 0; i < specifications.length; i++) {
                const spec = specifications[i];
                const optionIndex = indices[i];
                const option = spec.values[optionIndex];

                if (option && !option.isDisabled) {
                    await clickSkuOption(option.element);
                    await humanWait(500, 800);
                }
            }

            // 获取SKU信息
            await humanWait(800, 1200);
            const skuInfo = getSkuImageAndPrice(dialog);

            // 构建规格路径
            const path = specifications.map((spec, i) => ({
                key: spec.key,
                value: spec.values[indices[i]].text,
                index: indices[i]
            }));

            allSkus.push({
                ...skuInfo,
                specifications: path,
                pathText: path.map(p => `${p.key}: ${p.value}`).join(' | ')
            });

            // 更新索引（模拟n进制加法）
            let carry = 1;
            for (let i = specifications.length - 1; i >= 0 && carry > 0; i--) {
                indices[i] += carry;
                const spec = specifications[i];
                const enabledOptions = spec.values.filter(v => !v.isDisabled);

                if (indices[i] >= enabledOptions.length) {
                    indices[i] = 0;
                    carry = 1;
                } else {
                    carry = 0;
                }
            }

            // 如果所有索引都回到0，遍历完成
            if (indices.every((idx, i) => idx === 0 && specifications[i].values[0].isSelected)) {
                break;
            }
        }

        return allSkus;
    };

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
                await humanWait(300, 500);
            }

            // 模拟鼠标悬停
            const mouseOverEvent = new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(mouseOverEvent);
            await humanWait(100, 300);

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

            // 等待SKU信息更新（拼多多通常需要300-800ms更新价格和图片）
            await humanWait(500, 800);
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
        await humanWait(500, 800);

        // 模拟鼠标移动到按钮上
        const mouseOverEvent = new MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        button.dispatchEvent(mouseOverEvent);
        await humanWait(300, 600);

        // 模拟点击
        button.click();

        // 等待弹窗出现
        await humanWait(1000, 1500);
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
                await humanWait(800, 1200);
                return dialog;
            }

            console.log(`等待弹窗... (${i + 1}/${maxRetries})`);
            await humanWait(800, 1200);

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
                await humanWait(500, 800);
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

                // 1.5秒后断开observer
                setTimeout(() => {
                    if (this.observer) {
                        this.observer.disconnect();
                        this.observer = null;
                    }
                    resolve();
                }, 1500);
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
                    console.log('找到主图容器:', c.className);
                    break;
                }
            }

            if (container) {
                // 1. 查找主图
                const img = container.querySelector('img[src]');
                if (img && img.src) {
                    skuInfo.imageUrl = img.src;
                    console.log('🖼️ SKU主图:', img.src);
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
                            console.log('💰 SKU价格:', skuInfo.price);
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
                                console.log('💰 通过span组合找到价格:', skuInfo.price);
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

            console.log('🔍 查找规格分类...');

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
                const isSelected = classList.includes('hr353bdX') || // PDD option 选中的样式
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

    // 建议添加清理函数
    const cleanup = () => {
        // 清理全局变量
        try {
            delete window.currentExportNotification;
        } catch (e) {
            console.warn('清理window属性失败:', e.message);
        }

        // 清理定时器
        if (activationCheckTimer) {
            clearInterval(activationCheckTimer);
            activationCheckTimer = null;
        }
        // 移除storage监听器
        // if (storageChangeListener) {
        //     chrome.storage.onChanged.removeListener(storageChangeListener);
        //     storageChangeListener = null;
        // }
        // 新增：断开URL变化监听器
        if (urlChangeObserver) {
            urlChangeObserver.disconnect();
            urlChangeObserver = null;
        }

        // 清理事件监听器
        const panel = document.getElementById(CONFIG.panelId);
        if (panel) {
            const startBtn = panel.querySelector('#startCollectBtn');
            if (startBtn && startBtn._collectionHandler) {
                startBtn.removeEventListener('click', startBtn._collectionHandler);
            }
            const exportBtn = panel.querySelector('#exportDataBtn');
            if (exportBtn && exportBtn._exportHandler) {
                exportBtn.removeEventListener('click', exportBtn._exportHandler);
            }
        }

        // 清理通知和对话框
        removeExistingNotifications();

        // 清理定时器
        if (collectionQueue) {
            clearTimeout(collectionQueue);
            collectionQueue = null;
        }
    };


// 自动检测页面变化
    const setupAutoDetection = () => {
        // 先断开原有监听器
        if (urlChangeObserver) {
            urlChangeObserver.disconnect();
        }
        // 监听URL变化（单页应用）
        let lastUrl = location.href;
        urlChangeObserver = new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                console.log('🌐 URL变化，重新初始化...');
                cleanup();
                setTimeout(() => init(), 1500);
            }
        });
        urlChangeObserver.observe(document, {subtree: true, childList: true});
    };

// 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})
();