// popup/popup.js

document.addEventListener('DOMContentLoaded', function() {
    const activationCodeInput = document.getElementById('activationCode');
    const activateBtn = document.getElementById('activateBtn');
    const verifyBtn = document.getElementById('verifyBtn');
    const deactivateBtn = document.getElementById('deactivateBtn');
    const statusDisplay = document.getElementById('statusDisplay');
    const inactiveSection = document.getElementById('inactiveSection');
    const activeSection = document.getElementById('activeSection');
    const activationInfo = document.getElementById('activationInfo');
    const messageDiv = document.getElementById('message');

    // 检查激活状态
    function checkActivationStatus() {
        chrome.runtime.sendMessage({ action: 'getActivationStatus' }, (response) => {
            if (response && response.isActivated) {
                statusDisplay.textContent = '已激活';
                statusDisplay.className = 'status active';
                inactiveSection.style.display = 'none';
                activeSection.style.display = 'block';

                let infoHtml = `激活ID: ${response.activationId}<br>`;
                if (response.expiresAt) {
                    const expiresDate = new Date(response.expiresAt);
                    infoHtml += `到期时间: ${expiresDate.toLocaleDateString()}<br>`;

                    if (response.daysUntilExpiration > 0) {
                        infoHtml += `剩余天数: ${response.daysUntilExpiration}天`;
                    } else if (response.daysUntilExpiration === 0) {
                        infoHtml += `今天到期`;
                    } else {
                        infoHtml += `永久有效`;
                    }
                } else {
                    infoHtml += `永久有效`;
                }

                activationInfo.innerHTML = infoHtml;
            } else {
                statusDisplay.textContent = '未激活';
                statusDisplay.className = 'status inactive';
                inactiveSection.style.display = 'block';
                activeSection.style.display = 'none';
            }
        });
    }

    // 激活按钮点击
    activateBtn.addEventListener('click', function() {
        const activationCode = activationCodeInput.value.trim();

        if (!activationCode) {
            showMessage('请输入激活码', 'error');
            return;
        }

        activateBtn.disabled = true;
        activateBtn.textContent = '激活中...';

        chrome.runtime.sendMessage({
            action: 'activate',
            licenseKey: activationCode
        }, (response) => {
            if (response.success) {
                showMessage('激活成功！', 'success');
                activationCodeInput.value = '';
                checkActivationStatus();
            } else {
                showMessage('激活失败: ' + response.message, 'error');
            }

            activateBtn.disabled = false;
            activateBtn.textContent = '激活插件';
        });
    });

    // 验证按钮点击
    verifyBtn.addEventListener('click', function() {
        verifyBtn.disabled = true;
        verifyBtn.textContent = '验证中...';

        chrome.runtime.sendMessage({ action: 'verify' }, (response) => {
            if (response.valid) {
                showMessage('验证成功！激活状态正常', 'success');
                checkActivationStatus();
            } else {
                showMessage('验证失败: ' + response.reason, 'error');
            }

            verifyBtn.disabled = false;
            verifyBtn.textContent = '验证激活状态';
        });
    });

    // 解除激活按钮点击
    deactivateBtn.addEventListener('click', function() {
        if (confirm('确定要解除激活吗？解除后当前设备将无法使用插件。')) {
            deactivateBtn.disabled = true;
            deactivateBtn.textContent = '处理中...';

            chrome.runtime.sendMessage({ action: 'deactivate' }, (response) => {
                if (response.success) {
                    showMessage('已解除激活', 'success');
                    checkActivationStatus();
                } else {
                    showMessage('解除激活失败: ' + response.message, 'error');
                }

                deactivateBtn.disabled = false;
                deactivateBtn.textContent = '解除激活';
            });
        }
    });

    // 显示消息
    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.style.color = type === 'success' ? 'green' : 'red';

        setTimeout(() => {
            messageDiv.textContent = '';
        }, 3000);
    }

    // 初始化
    checkActivationStatus();
});