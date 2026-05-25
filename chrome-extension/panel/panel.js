document.addEventListener('DOMContentLoaded', function () {
    console.log('Panel loaded in iframe');

    // panel 向父窗口（拼多多页面）发消息，父窗口 origin 不固定，用 '*'
    // 安全由 content.js 的消息接收端校验（检查 event.source 和 event.origin）
    const PARENT_ORIGIN = '*';

    const panel = document.getElementById('pdd-collector-panel');
    const activationContainer = document.getElementById('pdd-activation-container');
    const contentArea = document.getElementById('panel-content-area');
    const activationStatusDisplay = document.getElementById('activation-status-display');
    const startCollectBtn = document.getElementById('startCollectBtn');
    const exportDataBtn = document.getElementById('exportDataBtn');
    const closePanelBtn = document.getElementById('closePanelBtn');
    const activateBtn = document.getElementById('panel-activate-btn');
    const activationCodeInput = document.getElementById('panel-activation-code');
    const activationMsg = document.getElementById('activation-msg');

    let currentActivationStatus = {
        isActivated: false,
        expiresAt: null,
        daysRemaining: -1
    };

    let currentTrialStatus = {
        trialCount: 0,
        trialMax: 0,
        tampered: false
    };

    let activationTimeout = null;
    let isCollecting = false;

    // 监听来自content.js的消息
    window.addEventListener('message', async function (event) {
        const {type, activationStatus, status, data, trialStatus} = event.data;

        switch (type) {
            case 'init':
                if (activationStatus) {
                    updateUI(activationStatus, trialStatus);
                }
                break;

            case 'activationStatus':
                if (status) {
                    updateUI(status, trialStatus);
                }
                break;

            case 'trialStatusUpdate':
                if (trialStatus) {
                    currentTrialStatus = trialStatus;
                    updateUI(currentActivationStatus, trialStatus);
                }
                break;

            case 'setButtonsEnabled':
                isCollecting = !event.data.enabled;
                if (startCollectBtn) startCollectBtn.disabled = isCollecting;
                if (exportDataBtn) exportDataBtn.disabled = isCollecting;
                if (startCollectBtn) startCollectBtn.textContent = isCollecting ? '采集中...' : '开始采集';
                break;

            case 'activationSuccess':
                if (activationTimeout) {
                    clearTimeout(activationTimeout);
                    activationTimeout = null;
                }
                if (activationStatus) {
                    showActivationMessage('✅ 激活成功！', 'success');
                    updateUI(activationStatus);

                    // 3秒后清除消息
                    setTimeout(() => {
                        showActivationMessage('');
                    }, 3000);
                }
                break;

            case 'activationError':
                if (activationTimeout) {
                    clearTimeout(activationTimeout);
                    activationTimeout = null;
                }
                if (activateBtn) {
                    activateBtn.disabled = false;
                    activateBtn.innerHTML = '🔓 立即激活';
                }
                showActivationMessage(`❌ ${event.data.message || '激活失败'}`, 'error');//eventData.message
                break;
        }
    });

    // 更新UI显示
    function updateUI(status, trial) {
        console.log('🔄 更新UI状态:', status);
        console.log('面板元素:', panel);
        console.log('激活容器:', activationContainer);
        console.log('内容区域:', contentArea);

        currentActivationStatus = status;
        if (trial) currentTrialStatus = trial;

        const hasTrial = !status.isActivated && currentTrialStatus.trialCount > 0;
        const trialExhausted = !status.isActivated && currentTrialStatus.trialCount <= 0;

        // 更新状态显示
        if (activationStatusDisplay) {
            if (status.isActivated) {
                let displayText = '已激活';
                let color = '#27ae60';
                if (status.daysRemaining > 30 || status.daysRemaining < 0) {
                    displayText = status.daysRemaining < 0 ? '永久有效' : `剩余 ${status.daysRemaining} 天`;
                    color = '#27ae60';
                } else if (status.daysRemaining <= 30 && status.daysRemaining > 7) {
                    displayText = `剩余 ${status.daysRemaining} 天`;
                    color = '#f39c12';
                } else if (status.daysRemaining <= 7 && status.daysRemaining > 0) {
                    displayText = `即将到期 (${status.daysRemaining}天)`;
                    color = '#e74c3c';
                } else if (status.daysRemaining === 0) {
                    displayText = '今日到期';
                    color = '#e74c3c';
                }

                activationStatusDisplay.textContent = displayText;
                activationStatusDisplay.style.color = color;
                console.log('✅ 更新状态显示:', displayText);
            } else if (hasTrial) {
                activationStatusDisplay.textContent = `试用中 (${currentTrialStatus.trialCount}/${currentTrialStatus.trialMax}次)`;
                activationStatusDisplay.style.color = '#f39c12';
            } else if (trialExhausted) {
                if (isCollecting) {
                    activationStatusDisplay.textContent = '采集中...';
                    activationStatusDisplay.style.color = '#f39c12';
                } else {
                    activationStatusDisplay.textContent = '试用已用完，请激活';
                    activationStatusDisplay.style.color = '#e74c3c';
                }
            } else {
                activationStatusDisplay.textContent = '未激活';
                activationStatusDisplay.style.color = '#e74c3c';
            }
        }

        // 更新激活容器和功能区域
        if (status.isActivated || hasTrial) {
            // 工具栏模式：紧凑横条，填满 iframe
            if (activationContainer) activationContainer.style.display = 'none';
            if (contentArea) contentArea.style.display = 'block';
            if (panel) {
                panel.classList.add('activated');
                panel.style.width = '100%';
                panel.style.height = '60px';
                panel.style.right = '0px';
                panel.style.bottom = '0px';
            }
            if (!isCollecting) {
                if (startCollectBtn) startCollectBtn.disabled = false;
                if (exportDataBtn) exportDataBtn.disabled = false;
            }
            if (startCollectBtn) startCollectBtn.textContent = isCollecting ? '采集中...' : '开始采集';
        } else if (trialExhausted) {
            if (isCollecting) {
                // 采集进行中：保持工具栏
                if (activationContainer) activationContainer.style.display = 'none';
                if (contentArea) contentArea.style.display = 'block';
                if (panel) { panel.classList.add('activated'); panel.style.width = '100%'; panel.style.height = '60px'; panel.style.right = '0px'; panel.style.bottom = '0px'; }
                if (startCollectBtn) startCollectBtn.disabled = true;
                if (exportDataBtn) exportDataBtn.disabled = false;
                if (startCollectBtn) startCollectBtn.textContent = '采集中...';
            } else {
                // 试用已用完：工具栏 + 激活表单
                if (activationContainer) {
                    activationContainer.style.display = 'flex';
                    activationContainer.style.opacity = '1';
                    activationContainer.style.visibility = 'visible';
                    activationContainer.style.pointerEvents = 'auto';
                }
                if (contentArea) contentArea.style.display = 'block';
                if (panel) { panel.classList.remove('activated'); panel.style.width = '100%'; panel.style.height = '100%'; panel.style.right = '0px'; panel.style.bottom = '0px'; }
                if (startCollectBtn) { startCollectBtn.disabled = true; startCollectBtn.textContent = '开始采集'; }
                if (exportDataBtn) exportDataBtn.disabled = false;
            }
        } else {
            if (activationContainer) {
                activationContainer.style.display = 'flex';
                activationContainer.style.opacity = '1';
                activationContainer.style.visibility = 'visible';
                activationContainer.style.pointerEvents = 'auto';
            }
            if (contentArea) contentArea.style.display = 'none';
            if (panel) { panel.classList.remove('activated'); panel.style.width = '100%'; panel.style.height = '100%'; panel.style.right = '0px'; panel.style.bottom = '0px'; }
            if (startCollectBtn) startCollectBtn.disabled = true;
            if (exportDataBtn) exportDataBtn.disabled = true;
            if (activationCodeInput) { setTimeout(function(){activationCodeInput.focus();},100); }
        }
        // 强制重绘
        if (panel) {
            void panel.offsetHeight;
        }
        // 发送消息给父窗口，调整 iframe 大小
        var panelMode;
        if (trialExhausted && !isCollecting) { panelMode = 'inactive'; }
        else if (trialExhausted && isCollecting) { panelMode = 'trial'; }
        else if (status.isActivated) { panelMode = 'activated'; }
        else if (hasTrial) { panelMode = 'trial'; }
        else { panelMode = 'inactive'; }
        window.parent.postMessage({
            type: 'panelResize',
            data: {
                mode: panelMode
            }
        }, PARENT_ORIGIN);

    }

    // 激活按钮事件
    if (activateBtn) {
        activateBtn.addEventListener('click', handleActivation);
    }

    // 激活码输入框事件
    if (activationCodeInput) {
        activationCodeInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                handleActivation();
            }
        });

        activationCodeInput.addEventListener('input', formatActivationCode);
        activationCodeInput.addEventListener('focus', function () {
            this.style.borderColor = '#ff9900';
            this.style.boxShadow = '0 0 0 3px rgba(255,153,0,0.2)';
        });
        activationCodeInput.addEventListener('blur', function () {
            this.style.borderColor = '#3a4255';
            this.style.boxShadow = 'none';
        });
    }

    // 激活处理函数
    async function handleActivation() {
        // 清除之前的定时器
        if (activationTimeout) {
            clearTimeout(activationTimeout);
            activationTimeout = null;
        }

        const code = activationCodeInput?.value.trim() || '';

        if (!code || code.length !== 36) {
            showActivationMessage('请输入36位有效激活码', 'error');
            return;
        }

        // 禁用按钮防重复提交
        if (activateBtn) {
            activateBtn.disabled = true;
            activateBtn.innerHTML = '激活中...';
        }

        showActivationMessage('正在验证激活码，请稍候...', 'info');

        // 发送激活请求到父页面
        window.parent.postMessage({
            type: 'activate',
            data: {activationCode: code}
        }, PARENT_ORIGIN);

        // 3秒后恢复按钮状态（如果没收到响应）
        activationTimeout = setTimeout(() => {
            if (activateBtn) {
                activateBtn.disabled = false;
                activateBtn.innerHTML = '🔓 立即激活';
                showActivationMessage('激活请求超时，请重试', 'error');
            }
        }, 3000);
    }

    // 格式化激活码
    function formatActivationCode(e) {
        let value = e.target.value;

        // 转换为小写
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

    // 显示激活消息
    function showActivationMessage(text, type = '') {
        if (activationMsg) {
            activationMsg.textContent = text;
            activationMsg.style.color =
                type === 'success' ? '#27ae60' :
                    type === 'error' ? '#e74c3c' :
                        type === 'info' ? '#3498db' : '#7f8c8d';
        }
    }

    // 功能按钮事件
    if (startCollectBtn) {
        startCollectBtn.addEventListener('click', function () {
            window.parent.postMessage({
                type: 'startCollection'
            }, PARENT_ORIGIN);
        });
    }

    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', function () {
            window.parent.postMessage({
                type: 'exportData'
            }, PARENT_ORIGIN);
        });
    }

    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', function () {
            window.parent.postMessage({
                type: 'closePanel'
            }, PARENT_ORIGIN);
        });
    }

    // 初始化时向父页面请求激活状态
    window.parent.postMessage({
        type: 'getActivationStatus'
    }, PARENT_ORIGIN);
});