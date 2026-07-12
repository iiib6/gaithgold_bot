// Al-Ghaith Gold Bot - Frontend Application Logic

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements - Inputs
    const ouncePriceInput = document.getElementById('ounce-price');
    const exchangeRateInput = document.getElementById('exchange-rate');
    const marketMarginInput = document.getElementById('market-margin');
    const displayConnectedPhone = document.getElementById('display-connected-phone');
    const geminiKeyInput = document.getElementById('config-gemini-key');
    const geminiInstructionsInput = document.getElementById('config-gemini-instructions');
    const adminUsernameInput = document.getElementById('config-admin-username');
    const adminPasswordInput = document.getElementById('config-admin-password');
    
    // UI Elements - Action Buttons
    const btnFetchLive = document.getElementById('btn-fetch-live');
    const btnSaveConfig = document.getElementById('btn-save-config');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    
    // UI Elements - Price Display
    const priceMithqal21 = document.getElementById('price-mithqal-21');
    const priceGram21 = document.getElementById('price-gram-21');
    const priceMithqal24 = document.getElementById('price-mithqal-24');
    const priceGram24 = document.getElementById('price-gram-24');
    const priceMithqal18 = document.getElementById('price-mithqal-18');
    const priceGram18 = document.getElementById('price-gram-18');
    
    // UI Elements - Tabs & Navigation
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // UI Elements - Chat Simulator
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const btnSendChat = document.getElementById('btn-send-chat');
    const typingIndicator = document.getElementById('typing-indicator');
    const quickReplyBtns = document.querySelectorAll('.quick-reply-btn');
    
    // UI Elements - Real WhatsApp Linkage
    const btnWhatsappConnect = document.getElementById('btn-whatsapp-connect');
    const btnWhatsappDisconnect = document.getElementById('btn-whatsapp-disconnect');
    const qrBox = document.getElementById('qr-box');
    const whatsappServerStatusBadge = document.getElementById('whatsapp-server-status-badge');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    // UI Elements - Logs
    const logEntries = document.getElementById('log-entries');
    
    // UI Elements - Monitoring & Toggle Panels
    const btnToggleChats = document.getElementById('btn-toggle-chats');
    const btnToggleLogs = document.getElementById('btn-toggle-logs');
    const chatsMonitorCard = document.getElementById('chats-monitor-card');
    const logsMonitorCard = document.getElementById('logs-monitor-card');
    const chatsThreadsList = document.getElementById('chats-threads-list');
    const chatsConversationHeader = document.getElementById('chats-conversation-header');
    const chatsConversationMessages = document.getElementById('chats-conversation-messages');
    const chatsCount = document.getElementById('chats-count');
    
    // Active Chats Monitor State
    const activeChats = {};
    let selectedChatId = null;
    
    // UI Elements - Panic Button & Analytics
    const btnPanic = document.getElementById('btn-panic');
    const btnPanicText = document.getElementById('btn-panic-text');
    const panicStatusText = document.getElementById('panic-status-text');
    const analyticsMsgsToday = document.getElementById('analytics-msgs-today');
    const analyticsCustomersTotal = document.getElementById('analytics-customers-total');
    const analyticsTopCustomer = document.getElementById('analytics-top-customer');

    // UI Elements - Right Panel Tabs
    const rightTabBtns = document.querySelectorAll('.right-tab-btn');
    const rightTabContents = document.querySelectorAll('.right-tab-content');

    // UI Elements - Auth Login
    const loginOverlay = document.getElementById('login-overlay');
    const loginUsername = document.getElementById('login-username');
    const loginPassword = document.getElementById('login-password');
    const btnLogin = document.getElementById('btn-login');
    const loginError = document.getElementById('login-error');
    const togglePasswordBtn = document.getElementById('toggle-password-btn');

    // UI Elements - Price Chart
    const chartCanvas = document.getElementById('price-chart');
    let priceChart = null;

    // UI Elements - Custom Q&A Manager
    const btnAddQna = document.getElementById('btn-add-qna');
    const qnaKeywords = document.getElementById('qna-keywords');
    const qnaReply = document.getElementById('qna-reply');
    const qnaRulesList = document.getElementById('qna-rules-list');
    
    // Global State
    let currentConfig = {
        ouncePrice: 3350,
        exchangeRate: 1480,
        marketMargin: 0,
        botName: "الغيث للذهب والمجوهرات",
        geminiApiKey: "",
        geminiInstructions: "",
        adminUsername: ""
    };
    
    let previousPrices = {};
    let authToken = localStorage.getItem('auth_token');
    let ws = null;
    let reconnectTimeout = null;
    let isLibAvailable = false;
    let mutedChatsList = {};
    let currentFreshness = null;

    // Auth helpers
    function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        return headers;
    }

    async function checkAuth() {
        if (!authToken) {
            // Try to see if auth is needed
            try {
                const res = await fetch('/api/config');
                if (res.ok) return; // no auth needed
            } catch (e) {}
            loginOverlay.style.display = 'flex';
            return;
        }
        // Verify token
        try {
            const res = await fetch('/api/config', { headers: getAuthHeaders() });
            if (res.ok) {
                fetchMutedChats();
                return;
            }
        } catch (e) {}
        // Token invalid
        localStorage.removeItem('auth_token');
        authToken = null;
        loginOverlay.style.display = 'flex';
    }

    async function handleLogin() {
        const username = loginUsername.value.trim();
        const password = loginPassword.value.trim();
        if (!username && !password) return;
        btnLogin.disabled = true;
        btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق...';
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success && data.token) {
                authToken = data.token;
                localStorage.setItem('auth_token', data.token);
                loginOverlay.style.display = 'none';
                loginError.style.display = 'none';
                initWebSocket();
                setupEventListeners();
                
                // Fetch status and analytics immediately after login
                fetchBotStatus();
                fetchAnalytics();
                fetchMutedChats();
            } else if (data.success && data.message === 'auth_disabled') {
                loginOverlay.style.display = 'none';
                loginError.style.display = 'none';
                
                // Fetch status and analytics immediately
                fetchBotStatus();
                fetchAnalytics();
                fetchMutedChats();
            } else {
                loginError.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة. حاول مرة أخرى.';
                loginError.style.display = 'block';
            }
        } catch (e) {
            loginError.textContent = 'خطأ في الاتصال بالخادم.';
            loginError.style.display = 'block';
        }
        btnLogin.disabled = false;
        btnLogin.innerHTML = 'تسجيل الدخول';
    }

    // Initialize App
    checkAuth();
    initWebSocket();
    setupEventListeners();

    // 1. WebSocket Connectivity
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        addLog('جاري محاولة الاتصال بخادم الـ WebSocket...', 'system');
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            addLog('تم الاتصال بنجاح بخادم الـ WebSocket المحلي.', 'system');
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'متصل بالخادم المحلي';
            showToast('تم الاتصال بنجاح بالخادم المحلي', 'success');
            
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        ws.onclose = () => {
            addLog('انقطع الاتصال بخادم الـ WebSocket. جاري محاولة إعادة الاتصال خلال 5 ثوانٍ...', 'err');
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = 'انقطع الاتصال بالخادم';
            
            // Reconnect
            if (!reconnectTimeout) {
                reconnectTimeout = setTimeout(initWebSocket, 5000);
            }
        };
        
        ws.onerror = (err) => {
            console.error('WebSocket Error:', err);
        };
    }

    function handleServerMessage(data) {
        switch (data.type) {
            case 'init':
                addLog('تم استقبال التكوين الأولي من الخادم.', 'system');
                updateConfigUI(data.config);
                updatePricesUI(data.prices, data.freshness || null);
                updateWhatsAppStatusUI(data.whatsapp);
                if (data.mutedChats) {
                    mutedChatsList = data.mutedChats;
                }
                break;
            case 'chat_mute_change':
                if (data.muted) {
                    mutedChatsList[data.phone] = data.expiry;
                } else {
                    delete mutedChatsList[data.phone];
                }
                renderChatsMonitor();
                break;
            case 'config_update':
                addLog('تم تحديث التكوين من قبل خادم الخلفية (أو بأمر واتساب).', 'system');
                updateConfigUI(data.config);
                if (data.prices) updatePricesUI(data.prices, data.freshness || null);
                break;
            case 'whatsapp_status':
                updateWhatsAppStatusUI(data);
                break;
            case 'log':
                if (data.logs) {
                    data.logs.forEach(log => {
                        const type = log.direction === 'INCOMING' ? 'in' : 'out';
                        const dirIcon = log.direction === 'INCOMING' ? '📥' : '📤';
                        const time = new Date(log.timestamp).toLocaleTimeString();
                        addLog(`[${time}] ${dirIcon} ${log.sender} (${log.senderPhone || ''}): ${log.message}`, type);
                        
                        // Feed into live chats monitor
                        if (log.senderPhone) {
                            const direction = log.direction === 'INCOMING' ? 'incoming' : 'outgoing';
                            const senderName = log.direction === 'INCOMING' ? log.sender : 'البوت';
                            addMessageToChatsMonitor(log.senderPhone, senderName, log.message, direction, new Date(log.timestamp));
                        }
                    });
                }
                break;
            case 'bot_status':
                updatePanicUI(data.enabled);
                break;
        }
    }

    // 2. Setup DOM Event Listeners
    function setupEventListeners() {
        // Tab switching
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                const targetTab = document.getElementById(btn.dataset.tab);
                if (targetTab) targetTab.classList.add('active');
            });
        });
        
        // Input change recalculations (client-side preview)
        ouncePriceInput.addEventListener('input', recalculateLocal);
        exchangeRateInput.addEventListener('input', recalculateLocal);
        marketMarginInput.addEventListener('input', recalculateLocal);
        
        // Buttons
        btnSaveConfig.addEventListener('click', saveConfigToServer);
        btnFetchLive.addEventListener('click', fetchLivePrice);
        btnClearLogs.addEventListener('click', () => {
            logEntries.innerHTML = '';
            addLog('تم مسح سجل العمليات.', 'system');
        });
        
        // Chat events
        btnSendChat.addEventListener('click', sendSimulatedMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendSimulatedMessage();
            }
        });
        
        // Quick Replies
        quickReplyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const messageText = btn.dataset.message;
                chatInput.value = messageText;
                sendSimulatedMessage();
            });
        });
        
        // Real WhatsApp Action buttons
        btnWhatsappConnect.addEventListener('click', connectRealWhatsApp);
        btnWhatsappDisconnect.addEventListener('click', disconnectRealWhatsApp);
        
        // Custom Q&A events
        btnAddQna.addEventListener('click', addCustomReplyRule);

        // Right panel tab switching
        rightTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                rightTabBtns.forEach(b => b.classList.remove('active'));
                rightTabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const target = document.getElementById(btn.dataset.rtab);
                if (target) target.classList.add('active');
            });
        });

        // Panic button
        btnPanic.addEventListener('click', toggleBotPanic);



        // Auth events
        btnLogin.addEventListener('click', handleLogin);
        loginPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        loginUsername.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loginPassword.focus();
        });

        // Toggle password visibility
        if (togglePasswordBtn) {
            togglePasswordBtn.addEventListener('click', () => {
                const isPassword = loginPassword.getAttribute('type') === 'password';
                loginPassword.setAttribute('type', isPassword ? 'text' : 'password');
                const icon = togglePasswordBtn.querySelector('i');
                if (icon) {
                    icon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
                }
            });
        }
    }

    // 3. Dynamic Local Pricing Calculator (Preview)
    function recalculateLocal() {
        const ouncePrice = Number(ouncePriceInput.value) || 0;
        const exchangeRate = Number(exchangeRateInput.value) || 0;
        const marketMargin = Number(marketMarginInput.value) || 0;
        
        const ouncePriceIQD = ouncePrice * exchangeRate;
        const baseGram24 = ouncePriceIQD / 31.1035;
        const baseGram21 = baseGram24 * 21 / 24;
        const baseMithqal21 = baseGram21 * 5;
        
        const finalMithqal21 = baseMithqal21 + marketMargin;
        const finalGram21 = finalMithqal21 / 5;
        
        const finalGram24 = finalGram21 * 24 / 21;
        const finalMithqal24 = finalGram24 * 5;
        
        const finalGram18 = finalGram24 * 18 / 24;
        const finalMithqal18 = finalGram18 * 5;
        
        const prices = {
            mithqal21: Math.round(finalMithqal21),
            gram21: Math.round(finalGram21),
            mithqal24: Math.round(finalMithqal24),
            gram24: Math.round(finalGram24),
            mithqal18: Math.round(finalMithqal18),
            gram18: Math.round(finalGram18)
        };
        
        updatePricesUI(prices);
    }

    // 4. Update UI Fields
    function updateConfigUI(config) {
        currentConfig = config;
        
        // Set values but only if not currently focused to avoid messing up typing
        if (document.activeElement !== ouncePriceInput) ouncePriceInput.value = config.ouncePrice;
        if (document.activeElement !== exchangeRateInput) exchangeRateInput.value = config.exchangeRate;
        if (document.activeElement !== marketMarginInput) marketMarginInput.value = config.marketMargin;
        if (config.ownerPhone && displayConnectedPhone) displayConnectedPhone.textContent = config.ownerPhone;
        if (document.activeElement !== geminiKeyInput) geminiKeyInput.value = config.geminiApiKey || '';
        if (document.activeElement !== geminiInstructionsInput) geminiInstructionsInput.value = config.geminiInstructions || '';
        if (document.activeElement !== adminUsernameInput) adminUsernameInput.value = config.adminUsername || '';
        if (document.activeElement !== adminPasswordInput) adminPasswordInput.value = config.adminPassword || '';
        
        renderCustomReplies(config.customReplies || []);
        recalculateLocal();
    }

    function updatePricesUI(prices, freshness) {
        // Update values and trigger flash animation if changed
        updatePriceField(priceMithqal21, prices.mithqal21, 'mithqal21');
        updatePriceField(priceGram21, prices.gram21, 'gram21');
        updatePriceField(priceMithqal24, prices.mithqal24, 'mithqal24');
        updatePriceField(priceGram24, prices.gram24, 'gram24');
        updatePriceField(priceMithqal18, prices.mithqal18, 'mithqal18');
        updatePriceField(priceGram18, prices.gram18, 'gram18');
        
        previousPrices = prices;
        if (freshness) {
            currentFreshness = freshness;
        } else if (prices.updatedAt && !currentFreshness) {
            currentFreshness = { goldUpdated: new Date(prices.updatedAt).getTime() };
        }
        updateLastUpdated();
    }

    function updateLastUpdated() {
        const el = document.getElementById('price-last-updated');
        if (!el) return;
        
        if (currentFreshness && currentFreshness.goldUpdated) {
            const d = new Date(currentFreshness.goldUpdated);
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            const s = String(d.getSeconds()).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const y = d.getFullYear();
            const goldSrc = currentFreshness.goldSource === 'backup' ? ' (Google Finance)' : currentFreshness.goldSource === 'primary' ? ' (gold-api.com)' : '';
            const exSrc = currentFreshness.exchangeSource === 'backup' ? ' (جوجل)' : currentFreshness.exchangeSource === 'primary' ? ' (egcurrency)' : '';
            const stale = currentFreshness.goldStale || currentFreshness.exchangeStale;
            el.innerHTML = stale
                ? `<span class="fs-stale">⚠️ آخر تحديث: ${dd}/${mo}/${y} ${h}:${m}:${s}${goldSrc} - تأخر في التحديث</span>`
                : `<span class="fs-fresh">✓ آخر تحديث: ${dd}/${mo}/${y} ${h}:${m}:${s}${goldSrc} | دولار: ${exSrc}</span>`;
        } else {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const mo = String(now.getMonth() + 1).padStart(2, '0');
            const y = now.getFullYear();
            el.textContent = `آخر تحديث: ${d}/${mo}/${y} ${h}:${m}:${s}`;
        }
    }

    function updatePriceField(element, newValue, key) {
        if (!element) return;
        
        const formattedValue = formatNumber(newValue);
        
        if (previousPrices[key] !== newValue) {
            element.textContent = formattedValue;
            if (previousPrices[key] !== undefined) {
                // Flash class for visual highlight
                element.parentElement.classList.add('flash-update');
                setTimeout(() => {
                    element.parentElement.classList.remove('flash-update');
                }, 800);
            }
        } else if (element.textContent === '---') {
            element.textContent = formattedValue;
        }
    }

    function updateWhatsAppStatusUI(whatsapp) {
        const status = whatsapp.status;
        const qrImage = whatsapp.qr;
        
        // Update local variable if explicitly provided
        if (whatsapp.libAvailable !== undefined) {
            isLibAvailable = whatsapp.libAvailable;
        }
        
        // Update badge text and style
        whatsappServerStatusBadge.textContent = getStatusArabicText(status);
        whatsappServerStatusBadge.className = 'badge ' + status.toLowerCase();
        
        // Update headers/buttons based on status
        if (status === 'CONNECTED') {
            btnWhatsappConnect.style.display = 'none';
            btnWhatsappDisconnect.style.display = 'inline-flex';
            qrBox.innerHTML = `
                <div class="qr-placeholder" style="color: var(--wa-green);">
                    <i class="fa-solid fa-circle-check" style="font-size: 4rem; color: var(--wa-green);"></i>
                    <p style="font-weight: 700; margin-top: 10px;">البوت متصل بالواتساب بنشاط!</p>
                    <p>يرد البوت حالياً على جميع رسائل الزبائن تلقائياً.</p>
                </div>
            `;
            // If we are linked, update global header status
            statusDot.className = 'status-dot connected';
            statusText.textContent = 'متصل بالواتساب بنشاط';
        } else if (status === 'QR_READY' && qrImage) {
            btnWhatsappConnect.style.display = 'none';
            btnWhatsappDisconnect.style.display = 'inline-flex';
            qrBox.innerHTML = `<img src="${qrImage}" alt="رمز QR للواتساب">`;
            statusDot.className = 'status-dot connecting';
            statusText.textContent = 'بانتظار مسح رمز الـ QR...';
        } else if (status === 'CONNECTING') {
            btnWhatsappConnect.style.display = 'none';
            btnWhatsappDisconnect.style.display = 'inline-flex';
            qrBox.innerHTML = `
                <div class="qr-placeholder">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 3rem; color: var(--accent-gold);"></i>
                    <p style="margin-top: 10px;">جاري تشغيل محرك الواتساب وتوليد الرمز...</p>
                </div>
            `;
            statusDot.className = 'status-dot connecting';
            statusText.textContent = 'جاري الاتصال بالواتساب...';
        } else { // DISCONNECTED
            btnWhatsappConnect.style.display = 'inline-flex';
            btnWhatsappDisconnect.style.display = 'none';
            qrBox.innerHTML = `
                <div class="qr-placeholder">
                    <i class="fa-solid fa-qrcode"></i>
                    <p>اضغط على زر "بدء الربط بالواتساب" لتوليد رمز الاستجابة السريعة (QR Code)</p>
                </div>
            `;
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                statusDot.className = 'status-dot connected';
                statusText.textContent = 'متصل بالخادم المحلي';
            }
        }
        
        // If library is not available, customize buttons/display
        if (!isLibAvailable) {
            btnWhatsappConnect.setAttribute('disabled', 'true');
            btnWhatsappConnect.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> الربط غير متوفر';
            qrBox.innerHTML = `
                <div class="qr-placeholder" style="color: var(--log-err); padding: 20px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 3.5rem; color: #ff5252;"></i>
                    <p style="font-weight: 700; margin-top: 10px; color: #ff5252;">محرك الواتساب الحقيقي غير مفعل</p>
                    <p style="font-size: 0.72rem; margin-top: 6px;">يرجى تثبيت مكتبة الاتصال في مجلد المشروع لتفعيل الربط بالهاتف:</p>
                    <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; display: block; margin-top: 8px; font-family: monospace;">npm install @whiskeysockets/baileys qrcode</code>
                </div>
            `;
        } else {
            // Re-enable if it was disabled before
            btnWhatsappConnect.removeAttribute('disabled');
            if (status === 'DISCONNECTED') {
                btnWhatsappConnect.innerHTML = '<i class="fa-solid fa-plug"></i> بدء الربط بالواتساب (توليد QR)';
            }
        }
    }

    function getStatusArabicText(status) {
        switch (status) {
            case 'CONNECTED': return 'متصل بنشاط';
            case 'QR_READY': return 'بانتظار المسح الرمز';
            case 'CONNECTING': return 'جاري الاتصال...';
            case 'DISCONNECTED': return 'غير متصل';
            default: return status;
        }
    }

    // 5. API Call Handlers

    // Save Configuration
    async function saveConfigToServer() {
        const configData = {
            ouncePrice: Number(ouncePriceInput.value),
            exchangeRate: Number(exchangeRateInput.value),
            marketMargin: Number(marketMarginInput.value),
            geminiApiKey: geminiKeyInput.value.trim(),
            geminiInstructions: geminiInstructionsInput.value.trim(),
            adminUsername: adminUsernameInput.value.trim(),
            adminPassword: adminPasswordInput.value.trim()
        };
        
        addLog(`إرسال طلب حفظ الإعدادات...`, 'system');
        
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(configData)
            });
            const data = await response.json();
            
            if (data.success) {
                showToast('تم حفظ الإعدادات بنجاح ومزامنتها!', 'success');
                addLog('تم تحديث وحفظ ملف الإعدادات بنجاح على الخادم.', 'system');
                updateConfigUI(data.config);
                updatePricesUI(data.prices);
            } else {
                throw new Error('Server returned failed status');
            }
        } catch (error) {
            console.error('Error saving config:', error);
            showToast('تعذر حفظ الإعدادات. يرجى التحقق من اتصال الخادم.', 'error');
            addLog(`خطأ في حفظ الإعدادات: ${error.message}`, 'err');
        }
    }

    // Fetch Live Ounce Price
    async function fetchLivePrice() {
        addLog('جاري طلب جلب سعر الأونصة العالمي من البورصة...', 'system');
        btnFetchLive.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الجلب...';
        btnFetchLive.setAttribute('disabled', 'true');
        
        try {
            const response = await fetch('/api/gold-price', { headers: getAuthHeaders() });
            const data = await response.json();
            
            if (data.success) {
                showToast(`تم جلب سعر الأونصة الحي: $${data.livePrice}`, 'success');
                addLog(`تم جلب السعر الحي بنجاح. أونصة الذهب: $${data.livePrice}`, 'system');
                updateConfigUI(data.config);
                updatePricesUI(data.prices, data.freshness || null);
            } else {
                throw new Error(data.message || 'API error');
            }
        } catch (error) {
            console.error('Error fetching live gold price:', error);
            showToast(error.message || 'تعذر جلب سعر الذهب العالمي. حاول لاحقاً.', 'error');
            addLog(`فشل جلب السعر الحي: ${error.message}`, 'err');
        } finally {
            btnFetchLive.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> جلب السعر الحي (البورصة)';
            btnFetchLive.removeAttribute('disabled');
        }
    }

    // Real WhatsApp Connection Management
    async function connectRealWhatsApp() {
        addLog('جاري تشغيل محرك واتساب وإرسال طلب الربط...', 'system');
        try {
            const response = await fetch('/api/whatsapp/connect', { method: 'POST', headers: getAuthHeaders() });
            const data = await response.json();
            if (data.success) {
                showToast(data.message, 'info');
            } else {
                showToast(data.message, 'error');
            }
        } catch (e) {
            console.error('Error connecting real WhatsApp:', e);
            showToast('تعذر الاتصال بالواتساب.', 'error');
        }
    }

    async function disconnectRealWhatsApp() {
        addLog('جاري إرسال طلب قطع الاتصال بالواتساب...', 'system');
        try {
            const response = await fetch('/api/whatsapp/disconnect', { method: 'POST', headers: getAuthHeaders() });
            const data = await response.json();
            if (data.success) {
                showToast(data.message, 'warning');
            }
        } catch (e) {
            console.error('Error disconnecting WhatsApp:', e);
        }
    }

    // 6. Analytics, Panic & CRM

    async function fetchAnalytics() {
        try {
            const res = await fetch('/api/analytics', { headers: getAuthHeaders() });
            const data = await res.json();
            if (!data.success) return;
            analyticsMsgsToday.textContent = data.todayMessages;
            analyticsCustomersTotal.textContent = data.totalCustomers;
            if (data.topCustomers && data.topCustomers.length > 0) {
                analyticsTopCustomer.textContent = data.topCustomers[0].name;
                analyticsTopCustomer.title = `${data.topCustomers[0].name}: ${data.topCustomers[0].count} رسالة`;
            } else {
                analyticsTopCustomer.textContent = '-';
            }
        } catch (e) {
            console.warn('[Analytics] Failed to load:', e);
        }
    }

    async function toggleBotPanic() {
        try {
            const res = await fetch('/api/bot/toggle', { method: 'POST', headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) {
                updatePanicUI(data.enabled);
                showToast(data.message, data.enabled ? 'success' : 'warning');
            }
        } catch (e) {
            console.error('[Panic] Error toggling bot:', e);
            showToast('تعذر تغيير حالة البوت.', 'error');
        }
    }

    function updatePanicUI(enabled) {
        if (enabled) {
            btnPanic.className = 'btn-panic active';
            btnPanicText.textContent = 'البوت شغال';
            panicStatusText.textContent = 'يعمل طبيعي';
            panicStatusText.style.color = 'var(--wa-green)';
        } else {
            btnPanic.className = 'btn-panic danger';
            btnPanicText.textContent = 'البوت موقف!';
            panicStatusText.textContent = 'موقف - الضغط للتشغيل';
            panicStatusText.style.color = '#ef4444';
        }
    }

    async function fetchBotStatus() {
        try {
            const res = await fetch('/api/bot/status', { headers: getAuthHeaders() });
            const data = await res.json();
            updatePanicUI(data.enabled);
        } catch (e) {
            console.warn('[Bot] Failed to load status:', e);
        }
    }

    async function fetchMutedChats() {
        try {
            const res = await fetch('/api/chats/muted', { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) {
                mutedChatsList = data.mutedChats || {};
                renderChatsMonitor();
            }
        } catch (e) {
            console.warn('[Takeover] Failed to load muted chats list:', e);
        }
    }

    // Initial fetches
    setTimeout(fetchAnalytics, 2500);
    setInterval(fetchAnalytics, 30000);
    setTimeout(fetchBotStatus, 1500);
    setTimeout(fetchMutedChats, 2000);

    // 7. WhatsApp Simulator Engine
    async function sendSimulatedMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        
        // Append user bubble to UI (right side - outgoing)
        appendMessageBubble(text, 'outgoing', 'الزبون');
        chatInput.value = '';
        
        // Feed into chats monitor
        addMessageToChatsMonitor('محاكي الواتساب', 'محاكي الواتساب', text, 'outgoing', new Date());
        
        // Scroll messages
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Show typing indicator
        typingIndicator.style.display = 'flex';
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        try {
            const response = await fetch('/api/simulate-message', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ message: text })
            });
            const data = await response.json();
            
            // Add a short delay for realistic bot reply simulation
            setTimeout(() => {
                typingIndicator.style.display = 'none';
                if (data.success) {
                    if (data.reply) {
                        appendMessageBubble(data.reply, 'incoming', 'الغيث للذهب');
                        addMessageToChatsMonitor('محاكي الواتساب', 'محاكي الواتساب', data.reply, 'outgoing', new Date());
                    }
                } else {
                    appendMessageBubble('عذراً، حدث خطأ في معالجة طلبك.', 'incoming', 'النظام');
                    addMessageToChatsMonitor('محاكي الواتساب', 'محاكي الواتساب', 'عذراً، حدث خطأ في معالجة طلبك.', 'outgoing', new Date());
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 1000);
            
        } catch (error) {
            console.error('Error in chat simulation API:', error);
            setTimeout(() => {
                typingIndicator.style.display = 'none';
                appendMessageBubble('خطأ: تعذر الاتصال بالخادم الذكي للبوت.', 'incoming', 'النظام');
                addMessageToChatsMonitor('محاكي الواتساب', 'محاكي الواتساب', 'خطأ: تعذر الاتصال بالخادم الذكي للبوت.', 'outgoing', new Date());
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 1000);
        }
    }

    function appendMessageBubble(message, direction, senderName) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${direction}`;
        
        const timeStr = new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
        
        // Check mark for outgoing messages
        const receipt = direction === 'outgoing' ? ' <i class="fa-solid fa-check-double read-receipt"></i>' : '';
        
        // If owner sent it, let's prepend an owner tag
        let prefixText = '';
        if (direction === 'outgoing') {
            prefixText = `<strong style="font-size: 0.68rem; display: block; margin-bottom: 2px; color: ${senderName === 'المالك' ? '#ffd54f' : '#b2dfdb'}">${senderName}:</strong>`;
        }
        
        msgDiv.innerHTML = `
            <div class="msg-bubble">
                ${prefixText}
                ${escapeHTML(message)}
                <span class="msg-time">${timeStr}${receipt}</span>
            </div>
        `;
        
        chatMessages.appendChild(msgDiv);
    }

    // 7. Utility Helpers
    function formatNumber(num) {
        return num.toLocaleString('ar-IQ');
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function addLog(message, type = 'system') {
        const log = document.createElement('div');
        log.className = `log-entry ${type}`;
        
        const time = new Date().toLocaleTimeString('ar-IQ', { hour12: false });
        log.innerHTML = `<span class="log-time">[${time}]</span> ${escapeHTML(message)}`;
        
        logEntries.appendChild(log);
        logEntries.scrollTop = logEntries.scrollHeight;
    }

    function showToast(message, type = 'success') {
        const toastContainer = document.getElementById('toast-container');
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'fa-circle-check';
        if (type === 'error') icon = 'fa-circle-xmark';
        if (type === 'warning') icon = 'fa-triangle-exclamation';
        if (type === 'info') icon = 'fa-circle-info';
        
        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        
        // Slide out and remove toast after 3.5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideInUp 0.3s reverse forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // 8. Custom Q&A Logic
    function renderCustomReplies(customReplies) {
        qnaRulesList.innerHTML = '';
        if (customReplies.length === 0) {
            qnaRulesList.innerHTML = '<p style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; padding: 10px;">لا يوجد ردود مضافة حالياً. أضف أول رد تلقائي بالأعلى!</p>';
            return;
        }
        
        customReplies.forEach((rule, index) => {
            const item = document.createElement('div');
            item.className = 'qna-rule-item';
            item.style.cssText = 'background: var(--bg-tertiary); border: 1px solid var(--gold-border); padding: 14px; border-radius: 8px; display: flex; align-items: start; gap: 6px; transition: all 0.2s ease; margin-bottom: 10px;';
            item.innerHTML = `
                <button class="btn-delete-qna btn-icon" data-index="${index}" style="color: #ef4444; padding: 2px; width: 28px; height: 28px; font-size: 0.8rem; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; flex-shrink: 0; margin-top: 2px;" title="حذف الرد"><i class="fa-solid fa-trash"></i></button>
                <div style="flex: 1; text-align: right; min-width: 0;">
                    <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <strong style="color: var(--text-primary); font-size: 0.82rem; font-weight: 700;">الكلمات:</strong> 
                        <span style="font-size: 0.78rem; color: #78350f; font-weight: 700; background: #fef3c7; padding: 3px 8px; border-radius: 6px; border: 1px solid #fde68a;">${escapeHTML(rule.keywords)}</span>
                    </div>
                    <p style="font-size: 0.82rem; color: var(--text-primary); margin-top: 8px; line-height: 1.5; white-space: pre-wrap; font-weight: 500;">${escapeHTML(rule.reply)}</p>
                </div>
            `;
            qnaRulesList.appendChild(item);
        });
        
        // Add delete event listeners
        document.querySelectorAll('.btn-delete-qna').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                deleteCustomReplyRule(index);
            });
        });
    }

    async function addCustomReplyRule() {
        const keywords = qnaKeywords.value.trim();
        const reply = qnaReply.value.trim();
        
        if (!keywords || !reply) {
            showToast('يرجى ملء حقول الكلمات المفتاحية والرد التلقائي.', 'error');
            return;
        }
        
        if (!currentConfig.customReplies) {
            currentConfig.customReplies = [];
        }
        
        currentConfig.customReplies.push({ keywords, reply });
        
        // Save to server
        await saveCustomRepliesToServer();
        
        // Clear inputs
        qnaKeywords.value = '';
        qnaReply.value = '';
        
        showToast('تمت إضافة الرد التلقائي بنجاح!', 'success');
    }

    async function deleteCustomReplyRule(index) {
        if (!confirm('هل أنت متأكد من رغبتك في حذف هذا الرد التلقائي؟')) return;
        
        currentConfig.customReplies.splice(index, 1);
        await saveCustomRepliesToServer();
        showToast('تم حذف الرد التلقائي.', 'warning');
    }

    async function saveCustomRepliesToServer() {
        addLog('مزامنة الردود المخصصة مع الخادم...', 'system');
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    ouncePrice: Number(ouncePriceInput.value),
                    exchangeRate: Number(exchangeRateInput.value),
                    marketMargin: Number(marketMarginInput.value),
                    customReplies: currentConfig.customReplies,
                    geminiApiKey: geminiKeyInput.value.trim(),
                    adminUsername: adminUsernameInput.value.trim(),
                    adminPassword: adminPasswordInput.value.trim()
                })
            });
            const data = await response.json();
            if (data.success) {
                updateConfigUI(data.config);
                updatePricesUI(data.prices);
            }
        } catch (e) {
            console.error('Error saving custom replies:', e);
            showToast('تعذر حفظ التغييرات على الخادم.', 'error');
        }
    }

    // --- Active Chats Monitor Rendering Logic (Messenger Style) ---
    function addMessageToChatsMonitor(contactId, contactName, messageText, direction, timestamp) {
        if (!activeChats[contactId]) {
            activeChats[contactId] = {
                name: contactName,
                phone: contactId,
                messages: [],
                unread: 0
            };
        }
        
        // Only increment unread for incoming messages when not viewing this chat
        if (direction === 'incoming' && selectedChatId !== contactId) {
            activeChats[contactId].unread = (activeChats[contactId].unread || 0) + 1;
        } else if (direction === 'incoming') {
            // If viewing this chat, reset unread
            activeChats[contactId].unread = 0;
        }
        
        activeChats[contactId].messages.push({
            text: messageText,
            direction: direction,
            time: timestamp || new Date()
        });
        
        // Auto-select first chat if none selected and chat count is 1
        if (!selectedChatId) {
            selectedChatId = contactId;
            activeChats[contactId].unread = 0; // reset unread when auto-selecting
        }
        
        renderChatsMonitor();
    }

    function getInitials(name) {
        if (!name) return '?';
        // Take first letter of each word, max 2 chars
        const parts = name.split(/[\s_]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function formatChatTime(date) {
        const now = new Date();
        const d = new Date(date);
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        
        if (diffMins < 1) return 'الآن';
        if (diffMins < 60) return `منذ ${diffMins} د`;
        if (diffHours < 24) return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
    }

    function renderChatsMonitor() {
        const chatKeys = Object.keys(activeChats);
        chatsCount.textContent = `${chatKeys.length} دردشات`;
        
        if (chatKeys.length === 0) {
            chatsThreadsList.innerHTML = `<div class="chats-empty-state"><i class="fa-regular fa-comment-dots"></i><p>لا توجد دردشات نشطة.</p></div>`;
            chatsConversationHeader.innerHTML = `<div style="margin: auto; text-align: center; color: var(--text-muted); font-size: 0.75rem;">اختر دردشة</div>`;
            chatsConversationMessages.innerHTML = `<div class="chats-empty-state"><i class="fa-regular fa-comment-dots"></i><p>اختر زبوناً لمشاهدة تفاصيل المحادثة.</p></div>`;
            return;
        }
        
        // Sort threads by last message time (newest first)
        chatKeys.sort((a, b) => {
            const aLast = activeChats[a].messages[activeChats[a].messages.length - 1]?.time || 0;
            const bLast = activeChats[b].messages[activeChats[b].messages.length - 1]?.time || 0;
            return new Date(bLast) - new Date(aLast);
        });
        
        chatsThreadsList.innerHTML = '';
        chatKeys.forEach(key => {
            const chat = activeChats[key];
            const lastMsg = chat.messages[chat.messages.length - 1];
            const timeStr = formatChatTime(lastMsg.time);
            const initials = getInitials(chat.name);
            const unread = chat.unread || 0;
            
            const isMuted = mutedChatsList[chat.phone] && new Date() < new Date(mutedChatsList[chat.phone]);
            
            const threadDiv = document.createElement('div');
            threadDiv.className = `chats-thread-item ${key === selectedChatId ? 'active' : ''}`;
            threadDiv.innerHTML = `
                <div class="thread-avatar">${initials}</div>
                <div class="thread-content">
                    <div class="thread-meta">
                        <span class="thread-name">${escapeHTML(chat.name)} ${isMuted ? '<i class="fa-solid fa-volume-xmark" style="color: #ef4444; font-size: 0.72rem; margin-right: 4px;" title="الرد التلقائي متوقف"></i>' : ''}</span>
                        <span class="thread-time">${timeStr}</span>
                    </div>
                    <div class="thread-preview">${escapeHTML(lastMsg.text)}</div>
                </div>
                ${unread > 0 ? `<div class="thread-unread">${unread}</div>` : ''}
            `;
            
            threadDiv.addEventListener('click', () => {
                selectedChatId = key;
                activeChats[key].unread = 0;
                renderChatsMonitor();
            });
            
            chatsThreadsList.appendChild(threadDiv);
        });
        
        // Render selected chat messages
        if (selectedChatId && activeChats[selectedChatId]) {
            const chat = activeChats[selectedChatId];
            const initials = getInitials(chat.name);
            const isMuted = mutedChatsList[chat.phone] && new Date() < new Date(mutedChatsList[chat.phone]);
            
            // Build conversation header with avatar & mute button
            chatsConversationHeader.innerHTML = `
                <div class="conv-avatar">${initials}</div>
                <div class="conv-info">
                    <span class="conv-name">${escapeHTML(chat.name)}</span>
                    <span class="conv-status">${chat.phone}</span>
                </div>
                <button id="btn-toggle-chat-mute" class="btn ${isMuted ? 'btn-danger' : 'btn-secondary'}" style="font-size: 0.72rem; padding: 6px 12px; gap: 6px; display: inline-flex; align-items: center; border-radius: 8px; font-family: 'Cairo', sans-serif;">
                    <i class="fa-solid ${isMuted ? 'fa-volume-xmark' : 'fa-robot'}"></i>
                    <span>${isMuted ? 'البوت مكتوم (تشغيل)' : 'كتم الرد الآلي'}</span>
                </button>
            `;
            
            const btnToggleChatMute = document.getElementById('btn-toggle-chat-mute');
            if (btnToggleChatMute) {
                btnToggleChatMute.addEventListener('click', async () => {
                    btnToggleChatMute.setAttribute('disabled', 'true');
                    try {
                        const response = await fetch('/api/chats/mute', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({
                                phone: chat.phone,
                                muted: !isMuted,
                                durationHours: 12
                            })
                        });
                        const data = await response.json();
                        if (data.success) {
                            if (data.muted) {
                                mutedChatsList[chat.phone] = data.expiry;
                                showToast('تم كتم الرد التلقائي لهذه المحادثة لمدة 12 ساعة', 'warning');
                            } else {
                                delete mutedChatsList[chat.phone];
                                showToast('تم تفعيل الرد التلقائي للبوت لهذه المحادثة', 'success');
                            }
                            renderChatsMonitor();
                        }
                    } catch (e) {
                        console.error('Error toggling chat mute:', e);
                        showToast('تعذر تغيير حالة كتم المحادثة.', 'error');
                    }
                    btnToggleChatMute.removeAttribute('disabled');
                });
            }
            
            chatsConversationMessages.innerHTML = '';
            chat.messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.className = `chats-monitor-msg ${msg.direction}`;
                
                const timeStr = new Date(msg.time).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
                const receipt = msg.direction === 'outgoing' ? ' <i class="fa-solid fa-check-double" style="font-size:0.6rem;color:#53bdeb;margin-right:2px;"></i>' : '';
                msgDiv.innerHTML = `
                    ${escapeHTML(msg.text)}
                    <span class="chats-monitor-msg-time">${timeStr}${receipt}</span>
                `;
                chatsConversationMessages.appendChild(msgDiv);
            });
            chatsConversationMessages.scrollTop = chatsConversationMessages.scrollHeight;
        }
    }

    // --- Price History Chart ---
    async function fetchAndRenderChart() {
        try {
            const res = await fetch('/api/price-history', { headers: getAuthHeaders() });
            const data = await res.json();
            if (!data.success || !data.history || data.history.length < 2) return;
            renderPriceChart(data.history);
        } catch (e) {
            console.warn('[Chart] Failed to load price history:', e);
        }
    }

    function renderPriceChart(history) {
        const labels = history.map(h => {
            const d = new Date(h.timestamp);
            return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
        });
        const prices = history.map(h => h.mithqal21);

        if (priceChart) { priceChart.destroy(); priceChart = null; }

        if (!chartCanvas) return;
        const ctx = chartCanvas.getContext('2d');
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'مثقال 21 (د.ع)',
                    data: prices,
                    borderColor: '#d4af37',
                    backgroundColor: 'rgba(212, 175, 55, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: 'rgba(212, 175, 55, 0.6)', font: { size: 10, weight: 'bold' }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(212, 175, 55, 0.15)' }
                    },
                    y: {
                        ticks: { color: 'rgba(212, 175, 55, 0.6)', font: { size: 10, weight: 'bold' }, callback: v => v.toLocaleString('ar-IQ') },
                        grid: { color: 'rgba(212, 175, 55, 0.15)' }
                    }
                },
                interaction: { intersect: false, mode: 'index' }
            }
        });
    }

    // Fetch chart data on init, then every 60s
    setTimeout(fetchAndRenderChart, 2000);
    setInterval(fetchAndRenderChart, 60000);

    // --- CRM: Customer List Rendering ---
    const crmList = document.getElementById('crm-list');
    const crmCount = document.getElementById('crm-count');

    async function fetchAndRenderCRM() {
        try {
            const res = await fetch('/api/customers', { headers: getAuthHeaders() });
            const data = await res.json();
            if (!data.success) return;
            renderCRM(data.customers, data.total);
        } catch (e) {
            console.warn('[CRM] Failed to load:', e);
        }
    }

    function renderCRM(customers, total) {
        crmCount.textContent = `${total} زبون`;
        if (!customers || customers.length === 0) {
            crmList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.8rem;">لا يوجد زبائن حتى الآن.</div>';
            return;
        }
        crmList.innerHTML = '';
        customers.forEach(c => {
            const time = new Date(c.lastContact).toLocaleDateString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border-gold); font-size: 0.78rem; cursor: pointer; transition: background 0.15s;';
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-user" style="color: var(--accent-gold-bright); width: 20px;"></i>
                    <div>
                        <strong style="color: var(--text-primary);">${c.name || 'زبون'}</strong>
                        <div style="font-size: 0.65rem; color: var(--text-secondary);">${c.phone}</div>
                    </div>
                </div>
                <div style="text-align: left; font-size: 0.65rem; color: var(--text-secondary);">
                    <div>${c.messageCount} رسالة</div>
                    <div>${time}</div>
                </div>
            `;
            div.addEventListener('mouseenter', () => { div.style.background = 'rgba(212, 175, 55, 0.08)'; });
            div.addEventListener('mouseleave', () => { div.style.background = ''; });
            div.addEventListener('click', () => showCRMMessages(c));
            crmList.appendChild(div);
        });
    }

    function showCRMMessages(customer) {
        const overlay = document.getElementById('crm-modal-overlay');
        const nameEl = document.getElementById('crm-modal-name');
        const phoneEl = document.getElementById('crm-modal-phone');
        const msgsEl = document.getElementById('crm-modal-messages');
        const closeBtn = document.getElementById('crm-modal-close');
        
        nameEl.textContent = customer.name || 'زبون';
        phoneEl.textContent = customer.phone || '';
        
        msgsEl.innerHTML = '';
        const chat = activeChats[customer.phone];
        if (chat && chat.messages && chat.messages.length > 0) {
            chat.messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.style.cssText = `max-width:80%;padding:8px 12px;border-radius:12px;font-size:0.78rem;line-height:1.4;word-wrap:break-word;align-self:${msg.direction === 'incoming' ? 'flex-start' : 'flex-end'};background:${msg.direction === 'incoming' ? 'var(--bg-tertiary)' : 'var(--accent-gold)'};color:${msg.direction === 'incoming' ? 'var(--text-primary)' : '#1a1a1a'};border-bottom-${msg.direction === 'incoming' ? 'left' : 'right'}-radius:4px;`;
                const timeStr = new Date(msg.time).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
                msgDiv.innerHTML = `${escapeHTML(msg.text)}<div style="font-size:0.6rem;opacity:0.7;margin-top:4px;text-align:left;direction:ltr;">${timeStr}</div>`;
                msgsEl.appendChild(msgDiv);
            });
        } else {
            msgsEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:0.78rem;padding:20px;">لا توجد رسائل مسجلة في هذه الجلسة.</div>';
        }
        
        overlay.style.display = 'flex';
        
        function closeModal() { overlay.style.display = 'none'; }
        closeBtn.onclick = closeModal;
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    }

    // Initial fetch + refresh every 30s
    setTimeout(fetchAndRenderCRM, 3000);
    setInterval(fetchAndRenderCRM, 30000);

    // --- Toggle Layout Panels Visibility ---
    function setupTogglePanels() {
        // Read initial states from localStorage or default to visible (true)
        let showChats = localStorage.getItem('panel_show_chats') !== 'false';
        let showLogs = localStorage.getItem('panel_show_logs') !== 'false';
        
        function updatePanelsUI() {
            if (showChats) {
                chatsMonitorCard.style.display = 'flex';
                btnToggleChats.querySelector('span').textContent = 'إخفاء الدردشات';
                btnToggleChats.classList.remove('btn-secondary');
                btnToggleChats.classList.add('btn-primary');
            } else {
                chatsMonitorCard.style.display = 'none';
                btnToggleChats.querySelector('span').textContent = 'إظهار الدردشات';
                btnToggleChats.classList.remove('btn-primary');
                btnToggleChats.classList.add('btn-secondary');
            }
            
            if (showLogs) {
                logsMonitorCard.style.display = 'flex';
                btnToggleLogs.querySelector('span').textContent = 'إخفاء السجل';
                btnToggleLogs.classList.remove('btn-secondary');
                btnToggleLogs.classList.add('btn-primary');
            } else {
                logsMonitorCard.style.display = 'none';
                btnToggleLogs.querySelector('span').textContent = 'إظهار السجل';
                btnToggleLogs.classList.remove('btn-primary');
                btnToggleLogs.classList.add('btn-secondary');
            }
            
            // Adjust panel columns grid if both are hidden, etc.
            const panelMonitoring = document.getElementById('panel-monitoring');
            if (!showChats && !showLogs) {
                panelMonitoring.style.opacity = '0.7';
            } else {
                panelMonitoring.style.opacity = '1';
            }
        }
        
        btnToggleChats.addEventListener('click', () => {
            showChats = !showChats;
            localStorage.setItem('panel_show_chats', showChats);
            updatePanelsUI();
        });
        
        btnToggleLogs.addEventListener('click', () => {
            showLogs = !showLogs;
            localStorage.setItem('panel_show_logs', showLogs);
            updatePanelsUI();
        });
        
        // Initial call
        updatePanelsUI();
    }
    
    // Call panel toggles setup
    setupTogglePanels();
});
