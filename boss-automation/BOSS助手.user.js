// ==UserScript==
// @name         BOSS直聘 AI海投+智能回聊+后台监控
// @namespace    http://tampermonkey.net/
// @version      3.2.0
// @description  v1.7.3原版核心 + 招呼语面板永久记忆 + 后台实时监控
// @match        https://www.zhipin.com/web/geek/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      *
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ========================== v1.7.3 原版状态 ==========================
    const state = {
        autoRunning: false, chatRunning: false,
        lastRepliedMsg: "", lastReplyTime: 0, chatTimer: null,
        processedChats: new Set(), currentChatId: null,
        stats: { scanned: 0, chatted: 0, skipped: 0, failed: 0 }
    };

    const config = {
        apiUrl: GM_getValue('apiUrl', 'https://api.deepseek.com/v1/chat/completions'),
        apiKey: GM_getValue('apiKey', '填写你的DeepSeek API Key（sk-开头）'),
        apiModel: GM_getValue('apiModel', 'deepseek-chat'),
        apiPrompt: GM_getValue('apiPrompt', '你是一个正在找工作的求职者。请根据HR的回复生成得体、专业的回复。要求：字数50字以内，积极促成面试，不要有任何拒绝的言辞。如果被要简历，请说"好的，没问题"。'),
        includeKw: GM_getValue('includeKw', ''),
        excludeKw: GM_getValue('excludeKw', ''),
        greetText: GM_getValue('greetText', '您好！我对该职位很感兴趣，我的专业技能十分契合，期待能有面试机会！'),
    };

    const DEBUG = GM_getValue('debugMode', false);
    function debugLog(...args) { if (DEBUG) console.log('%c[BOSS-AI]', 'color:#0f766e;font-weight:bold', ...args); }

    // ========================== v1.7.3 选择器 ==========================
    function querySelectorFallback(selectors, parent = document) {
        for (const sel of selectors) { try { const el = parent.querySelector(sel); if (el) return el; } catch (e) {} }
        return null;
    }
    function querySelectorAllFallback(selectors, parent = document) {
        for (const sel of selectors) { try { const els = parent.querySelectorAll(sel); if (els.length > 0) return Array.from(els); } catch (e) {} }
        return [];
    }

    const S = {
        jobCard: ['.job-card-wrapper','.job-card-box','[class*="job-card"]','.job-list-wrapper .job-card','.job-primary','[class*="JobCard"]','li.job-card','div[data-jobid]'],
        jobName: ['.job-name','.job-title','[class*="job-name"]','.job-card-left .name','[class*="jobName"]','a .job-title'],
        companyName: ['.company-name','[class*="company-name"]','.company-info a','[class*="companyName"]','.name'],
        chatBtn: ['a.op-btn-chat','.op-btn-chat','a[class*="op-btn-chat"]','.job-detail-box .op-btn-chat','.detail-op-list .op-btn-chat','.btn-startchat','a[class*="btn-startchat"]','a[class*="startchat"]','button[class*="chat"]','a[class*="chat-btn"]','a[ka*="chat"]','a[ka*="start_chat"]'],
        chatBtnTexts: ['立即沟通','继续沟通','立即打招呼','继续打招呼','聊一聊','立即聊一聊'],
        nextPage: ['.ui-icon-arrow-right','a .ui-icon-arrow-right','.options-pages a:last-child','a[class*="next"]','button[class*="next"]','.pagination .next','.page .next','a[ka*="next"]'],
        chatInput: ['#chat-input','div[contenteditable="true"][class*="chat-input"]','.chat-input [contenteditable]','div[contenteditable].input','[contenteditable="true"]','textarea[placeholder*="说点什么"]'],
        sendBtn: ['.btn-send','button[class*="btn-send"]','.chat-send','button[class*="send"]','button[type="button"][class*="send"]','a[class*="send"]'],
        detailBox: ['.job-detail-box','.job-detail','[class*="job-detail"]','.detail-content','[class*="DetailBox"]'],
        chatListItem: ['ul[role="group"] li[role="listitem"]','div[class*="user-list"] li','ul[role="group"] li','.chat-list li','[class*="chat-list"] li','.user-list-item','[class*="user-list-item"]','[class*="ChatItem"]'],
        hrName: ['.name-text','.name','[class*="name-text"]','[class*="name"]'],
        unreadBadge: ['.bp-badge','[class*="badge"]','[class*="unread"]','[class*="message-count"]','[class*="red-dot"]','span[class*="count"]','em[class*="num"]'],
        msgText: ['.text span','.text','.message-card-wrap','[class*="text"] span','[class*="msg-text"]'],
        lastMsgPreview: ['.last-message','[class*="last-message"]','.message','[class*="message"]','[class*="msg-preview"]','.gray-text','[class*="gray"]'],
        messageItem: ['.message-item','[class*="message-item"]','[class*="msg-item"]','.chat-record [class*="item"]','[class*="MessageItem"]'],
        hrMsgClass: ['item-friend','msg-from-hr','from-other','message-item-friend','friend'],
        stayBtn: ['button','a','.btn','.cancel-btn','.default-btn'],
        closeBtn: ['.icon-close','.chat-close','.boss-dialog-close','.dialog-close','[class*="close"]','[aria-label="关闭"]'],
        chatBlockDialog: ['.chat-block-dialog','[class*="chat-block"]','[class*="limit-dialog"]','[class*="block-dialog"]','[class*="exceed"]'],
        chatItemClickTarget: ['.figure','.name-box','.name-text','a','[class*="figure"]']
    };

    function isChatBtnAvailable(btn) {
        if (!btn) return false;
        if (btn.classList.contains('disabled') || btn.hasAttribute('disabled')) return false;
        if (btn.offsetParent === null && getComputedStyle(btn).position !== 'fixed') return false;
        const t = (btn.innerText || btn.textContent || '').trim();
        return S.chatBtnTexts.some(x => t.includes(x)) && !t.includes('已沟通过') && !t.includes('不合适');
    }

    // ========================== 增强：招呼语持久化 ==========================
    function saveGreeting() {
        const el = document.getElementById('cfg-greet');
        if (el) { config.greetText = el.value.trim(); GM_setValue('greetText', config.greetText); }
    }

    // ⭐ 增强：后端上报（不管sendChatBoxMsg成功与否，点击沟通即上报）
    async function toBackend(type, data) {
        try {
            const res = await fetch('http://127.0.0.1:8899/api/report', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({type, ...data})
            });
            if (!res.ok) debugLog('后端上报失败:', res.status);
        } catch(e) { debugLog('后端离线:', e.message); }
    }

    // ========================== v1.7.3 UI ==========================
    GM_addStyle(`
#bp{position:fixed;top:80px;right:20px;width:340px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);border-radius:12px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;display:flex;flex-direction:column}
#bp.mini{height:45px;width:200px}
.bh{background:linear-gradient(135deg,#0f766e,#14b8a6);color:#fff;padding:12px 16px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
.bh button{background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:4px;cursor:pointer;padding:2px 8px}
.bt{display:flex;background:#f1f2f5}
.bt button{flex:1;padding:10px 0;text-align:center;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;color:#666}
.bt button.ac{background:#fff;color:#0f766e;border-bottom:2px solid #0f766e}
.bb{padding:15px;max-height:500px;overflow-y:auto;font-size:13px}
.pane{display:none;flex-direction:column;gap:10px}
.pane.ac{display:flex}
.pane label{font-weight:bold;color:#333;font-size:12px;display:flex;flex-direction:column;gap:4px}
.pane label span{font-weight:400;color:#94a3b8;font-size:10px}
.pane input,.pane textarea,.pane input[type="password"]{width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-family:inherit;font-size:13px}
.pane textarea{resize:vertical;min-height:50px}
.btn{padding:10px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;color:#fff;width:100%;transition:.2s}
.btn:hover{opacity:.8}
.btn-p{background:#0f766e}.btn-d{background:#ff4d4f}.btn-s{background:#52c41a}.btn-m{background:#7c3aed}
.br{display:flex;gap:8px}.br .btn{flex:1}
.blog{background:#282c34;color:#abb2bf;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;min-height:60px;max-height:150px;overflow-y:auto;line-height:1.5}
.sg{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;text-align:center}
.sg .v{font-size:18px;font-weight:700;color:#0f766e}.sg .l{font-size:10px;color:#94a3b8}
`);

    document.body.insertAdjacentHTML('beforeend', `
<div id="bp">
  <div class="bh" id="bp-drag"><span>🤖 BOSS助手 v3.2</span><button id="bp-mini">_</button></div>
  <div class="bt">
    <button class="ac" data-p="p0">⚙️ AI设置</button>
    <button data-p="p1">📤 海投</button>
    <button data-p="p2">💬 代聊</button>
  </div>
  <div class="bb">
    <div id="p0" class="pane ac">
      <label>API Base URL</label>
      <input type="text" id="cfg-apiUrl" value="${config.apiUrl}">
      <label>API Key <span>DeepSeek或兼容API的Key</span></label>
      <input type="password" id="cfg-apiKey" value="${config.apiKey}" placeholder="sk-...">
      <label>模型名称</label>
      <input type="text" id="cfg-apiModel" value="${config.apiModel}">
      <label>AI 人设提示词</label>
      <textarea id="cfg-apiPrompt">${config.apiPrompt}</textarea>
      <label>📝 打招呼语 <span>⚡永久记忆</span></label>
      <textarea id="cfg-greet">${config.greetText}</textarea>
      <label>包含关键词 <span>空格分隔，命中才投</span></label>
      <input type="text" id="cfg-inc" value="${config.includeKw}" placeholder="AI SaaS 大模型">
      <label>排除关键词 <span>命中直接跳过</span></label>
      <input type="text" id="cfg-exc" value="${config.excludeKw}" placeholder="外包 保险 贷款">
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <input type="checkbox" id="cfg-debug" ${DEBUG?'checked':''} style="width:auto">
        <label style="margin:0;font-weight:400;font-size:12px;color:#666">调试模式(F12控制台)</label>
      </div>
      <button class="btn btn-p" id="btn-save">💾 保存所有配置（永久记忆）</button>
      <button class="btn btn-m" id="btn-backend">📊 打开后台监控 (http://127.0.0.1:8899)</button>
    </div>
    <div id="p1" class="pane">
      <div class="sg">
        <div><div class="v" id="st-scan">0</div><div class="l">扫描</div></div>
        <div><div class="v" id="st-chat">0</div><div class="l">已投</div></div>
        <div><div class="v" id="st-skip">0</div><div class="l">跳过</div></div>
      </div>
      <div class="br">
        <button class="btn btn-p" id="btn-start">▶ 开始海投</button>
        <button class="btn btn-d" id="btn-stop" style="display:none">■ 停止</button>
      </div>
      <div class="blog" id="log-apply">等待操作...</div>
    </div>
    <div id="p2" class="pane">
      <div style="font-size:12px;color:#666">进入BOSS【消息】页面后开启，AI自动回复红点消息</div>
      <div class="br">
        <button class="btn btn-s" id="btn-chat">▶ AI巡航代聊</button>
        <button class="btn btn-d" id="btn-chat-stop" style="display:none">■ 停止</button>
      </div>
      <div class="blog" id="log-chat">等待开启...</div>
    </div>
  </div>
</div>`);

    // ========================== UI交互 ==========================
    const panel = document.getElementById('bp');
    document.getElementById('bp-mini').onclick = e => { e.stopPropagation(); panel.classList.toggle('mini'); };
    document.querySelectorAll('.bt button').forEach(b => b.onclick = function() {
        document.querySelectorAll('.bt button,.pane').forEach(x => x.classList.remove('ac'));
        this.classList.add('ac'); document.getElementById(this.dataset.p).classList.add('ac');
    });

    // 拖动
    let drag=false,sx,sy,px,py;
    document.getElementById('bp-drag').onmousedown = e => {
        if (e.target.tagName==='BUTTON') return;
        drag=true;sx=e.clientX;sy=e.clientY;
        const r=panel.getBoundingClientRect();px=r.left;py=r.top;
        panel.style.transition='none';e.preventDefault();
    };
    document.onmousemove = e => { if(!drag)return; panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,px+e.clientX-sx))+'px'; panel.style.top=Math.max(0,Math.min(innerHeight-50,py+e.clientY-sy))+'px'; panel.style.right='auto'; };
    document.onmouseup = () => { if(drag){drag=false;panel.style.transition='all .3s';} };

    function updateUI() {
        document.getElementById('st-scan').textContent = state.stats.scanned;
        document.getElementById('st-chat').textContent = state.stats.chatted;
        document.getElementById('st-skip').textContent = state.stats.skipped;
    }
    function panelLog(id, msg) {
        const b = document.getElementById(id); if(!b) return;
        b.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
        b.scrollTop = b.scrollHeight;
        while (b.children.length > 80) b.firstChild.remove();
    }

    // 打招呼语实时保存
    document.getElementById('cfg-greet').oninput = () => { saveGreeting(); };
    document.getElementById('cfg-greet').onblur = () => { saveGreeting(); panelLog('log-apply','💾 打招呼语已保存'); };

    // 保存所有配置（包括API设置）
    document.getElementById('btn-save').onclick = () => {
        config.apiUrl = document.getElementById('cfg-apiUrl').value.trim();
        config.apiKey = document.getElementById('cfg-apiKey').value.trim();
        config.apiModel = document.getElementById('cfg-apiModel').value.trim();
        config.apiPrompt = document.getElementById('cfg-apiPrompt').value.trim();
        config.greetText = document.getElementById('cfg-greet').value.trim();
        config.includeKw = document.getElementById('cfg-inc').value.trim();
        config.excludeKw = document.getElementById('cfg-exc').value.trim();
        GM_setValue('apiUrl', config.apiUrl);
        GM_setValue('apiKey', config.apiKey);
        GM_setValue('apiModel', config.apiModel);
        GM_setValue('apiPrompt', config.apiPrompt);
        GM_setValue('greetText', config.greetText);
        GM_setValue('includeKw', config.includeKw);
        GM_setValue('excludeKw', config.excludeKw);
        GM_setValue('debugMode', document.getElementById('cfg-debug')?.checked || false);
        panelLog('log-apply', '✅ 全部配置已永久保存（含API Key/招呼语/关键词）');
    };

    // 打开后台
    document.getElementById('btn-backend').onclick = () => { window.open('http://127.0.0.1:8899','_blank'); };

    // ========================== v1.7.3 工具函数 ==========================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function checkKeywordMatch(text, inc, exc) {
        const tl = (text||'').toLowerCase();
        const ii = (inc||'').split(/\s+/).filter(Boolean);
        const ee = (exc||'').split(/\s+/).filter(Boolean);
        if (ee.some(k => tl.includes(k.toLowerCase()))) return false;
        if (!ii.length) return true;
        return ii.some(k => tl.includes(k.toLowerCase()));
    }

    // ========================== v1.7.3 三层点击 ==========================
    async function simulateClick(element) {
        if (!element) return false;
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(100);
        const r = element.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        try {
            ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
                const EC = type.startsWith('pointer') ? PointerEvent : MouseEvent;
                element.dispatchEvent(new EC(type, {
                    bubbles: true, cancelable: true, composed: true,
                    clientX: x, clientY: y, button: 0,
                    buttons: type.includes('down') ? 1 : 0,
                    pointerType: 'mouse', isPrimary: true
                }));
            });
        } catch(e) {}
        try { element.click(); } catch(e) {}
        return true;
    }

    // ========================== v1.7.3 五层输入 ==========================
    async function sendChatBoxMsg(text) {
        const input = querySelectorFallback(S.chatInput);
        if (!input) { debugLog('输入框未找到'); return false; }
        input.scrollIntoView({ block: 'center' }); input.focus(); await sleep(200);
        if (input.tagName==='TEXTAREA'||input.tagName==='INPUT') input.value = '';
        else { input.textContent = ''; input.innerHTML = ''; }
        input.dispatchEvent(new FocusEvent('focus', { bubbles: true })); await sleep(100);
        try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, text); } catch(e) {}
        if (!input.textContent?.trim() && !input.value) {
            if (input.tagName==='TEXTAREA'||input.tagName==='INPUT') input.value = text;
            else { const dt = new DataTransfer(); dt.setData('text/plain', text);
                input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                if (!input.textContent.trim()) input.textContent = text; }
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); await sleep(800);
        if (!(input.value || input.textContent || '').trim()) { debugLog('输入框空'); return false; }
        const sendBtn = querySelectorFallback(S.sendBtn);
        if (sendBtn && !sendBtn.classList.contains('disabled') && sendBtn.offsetParent) { await simulateClick(sendBtn); await sleep(600); if (!(input.value || input.textContent || '').trim()) return true; }
        ['keydown','keypress'].forEach(type => { input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); });
        await sleep(500);
        return !(input.value || input.textContent || '').trim();
    }

    // ========================== v1.7.3 弹窗处理 ==========================
    async function clearBlockingModals() {
        for (const b of document.querySelectorAll(S.stayBtn.join(','))) {
            const t = (b.innerText||b.textContent||'').trim();
            if (['留在此页','留在这','继续查看','取消'].some(x => t.includes(x)) && b.offsetParent) { await simulateClick(b); await sleep(400); break; }
        }
        for (const d of querySelectorAllFallback(S.chatBlockDialog)) {
            if (d.offsetParent) { const ok = d.querySelector('button,.btn,.confirm-btn,[class*="confirm"]'); if (ok) await simulateClick(ok); else d.style.display='none'; await sleep(400); }
        }
        for (const b of document.querySelectorAll(S.closeBtn.join(','))) { if (b.offsetParent) simulateClick(b); }
        await sleep(500);
    }

    // ========================== v1.7.3 AI调用 ==========================
    async function requestAI(historyMessages) {
        if (!config.apiKey) { panelLog("log-chat","❌ API Key为空"); return null; }
        const payload = { model: config.apiModel, messages: [{ role: "system", content: config.apiPrompt }, ...historyMessages], temperature: 0.7 };
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method:"POST", url:config.apiUrl,
                headers:{"Content-Type":"application/json","Authorization":"Bearer "+config.apiKey},
                data:JSON.stringify(payload),
                onload:r=>{try{const d=JSON.parse(r.responseText);resolve(d.choices?.[0]?.message?.content||null)}catch(e){resolve(null)}},
                onerror:()=>resolve(null)
            });
        });
    }

    // ========================== v1.7.3 自动海投（完整保留） ==========================
    document.getElementById('btn-start').onclick = async () => {
        if (!location.href.includes('/web/geek/job')) { alert("请在BOSS【职位/推荐】页面使用！\n当前: " + location.pathname); return; }
        // ⭐ 从面板重新读取最新招呼语（确保是用户最新输入）
        const greetText = GM_getValue('greetText', config.greetText);
        config.greetText = greetText;
        state.autoRunning = true; state.stats = { scanned: 0, chatted: 0, skipped: 0, failed: 0 };
        updateUI();
        document.getElementById('btn-start').style.display = 'none';
        document.getElementById('btn-stop').style.display = 'inline-block';
        panelLog("log-apply", '🚀 海投启动 | 招呼语: ' + greetText.substring(0,20) + '...');

        let noDataCount = 0, turn = 0;
        while (state.autoRunning) {
            turn++; await sleep(1500);
            let cards = querySelectorAllFallback(S.jobCard);
            let fresh = cards.filter(c => !c.dataset.aiProcessed);
            debugLog('轮次', turn, '-总:', cards.length, '-新:', fresh.length);

            if (fresh.length === 0) {
                const nextBtn = querySelectorFallback(S.nextPage);
                if (nextBtn && nextBtn.offsetParent && !nextBtn.classList.contains('disabled')) {
                    panelLog("log-apply", '🔄 翻页');
                    await simulateClick(nextBtn); await sleep(4000);
                    noDataCount = 0; continue;
                }
                panelLog("log-apply", '⏬ 滚动加载');
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
                await sleep(2500);
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
                await sleep(2500);
                const nc = querySelectorAllFallback(S.jobCard).filter(c => !c.dataset.aiProcessed);
                if (!nc.length) { noDataCount++; if (noDataCount >= 3) { panelLog("log-apply", '🏁 已到底部'); state.autoRunning = false; break; } }
                else noDataCount = 0;
                continue;
            }
            noDataCount = 0;

            for (let card of fresh) {
                if (!state.autoRunning) break;
                card.dataset.aiProcessed = "true";
                state.stats.scanned++; updateUI();
                try {
                    const r = card.getBoundingClientRect();
                    if (r.top > window.innerHeight || r.bottom < 0) { card.scrollIntoView({ block:'center', behavior:'smooth' }); await sleep(200); }
                    const jobName = (querySelectorFallback(S.jobName, card)?.innerText||'').trim();
                    const companyName = (querySelectorFallback(S.companyName, card)?.innerText||'').trim();
                    if (!jobName) { state.stats.skipped++; continue; }
                    if (!checkKeywordMatch(jobName+' '+companyName, config.includeKw, config.excludeKw)) { state.stats.skipped++; updateUI(); continue; }
                    panelLog("log-apply", '👀 ' + jobName + ' @ ' + companyName);

                    await simulateClick(card);
                    panelLog("log-apply", '⏳ 等待详情...');
                    await sleep(2000);

                    let detailBox = null;
                    for (let w = 0; w < 8; w++) {
                        await sleep(2000);
                        for (const c of document.querySelectorAll(S.detailBox.join(', '))) {
                            if (c.offsetParent && c.getBoundingClientRect().height > 100) { detailBox = c; break; }
                        }
                        if (detailBox) break;
                    }
                    if (!detailBox) { panelLog("log-apply", '⚠️ 详情未加载'); state.stats.failed++; updateUI(); continue; }
                    detailBox.scrollIntoView({ block: 'start', behavior: 'smooth' }); await sleep(500);

                    let chatBtn = null;
                    for (const b of detailBox.querySelectorAll(S.chatBtn.join(', '))) { if (isChatBtnAvailable(b)) { chatBtn = b; break; } }
                    if (!chatBtn) {
                        chatBtn = querySelectorFallback(S.chatBtn);
                        if (chatBtn && !isChatBtnAvailable(chatBtn)) chatBtn = null;
                    }
                    if (!chatBtn) {
                        for (const el of document.querySelectorAll('a,button')) {
                            const t = (el.innerText||'').trim();
                            if (['立即沟通','继续沟通','立即打招呼'].includes(t) && el.offsetParent) { chatBtn = el; break; }
                        }
                    }

                    if (chatBtn) {
                        debugLog('沟通按钮:', chatBtn.className, chatBtn.innerText);
                        chatBtn.scrollIntoView({ block:'center', behavior:'smooth' }); await sleep(300);
                        await simulateClick(chatBtn);
                        panelLog("log-apply", '👉 已点沟通');
                        await sleep(2500);

                        let success = false;
                        for (let retry = 0; retry < 3; retry++) {
                            success = await sendChatBoxMsg(greetText);
                            if (success) break;
                            await sleep(1500);
                        }
                        panelLog("log-apply", success ? '💬 已发送 ✓' : '⚠️ BOSS自动发送，自定义招呼语作为补充已尝试发送');
                        state.stats.chatted++;
                        // ⭐ 后端上报：始终用面板招呼语
                        await toBackend('apply', { jobInfo:{title:jobName,company:companyName}, greeting: greetText });
                        updateUI();
                        await clearBlockingModals();
                    } else {
                        panelLog("log-apply", '⏸️ ' + jobName + ' (无按钮)');
                        state.stats.skipped++; updateUI();
                    }
                    await sleep(1000);
                } catch (err) { debugLog('异常:', err.message); state.stats.failed++; updateUI(); await sleep(1000); }
            }
        }
        document.getElementById('btn-start').style.display = 'inline-block';
        document.getElementById('btn-stop').style.display = 'none';
        panelLog("log-apply", '⏹️ 结束 | 投' + state.stats.chatted + ' | 跳' + state.stats.skipped + ' | 败' + state.stats.failed);
        await toBackend('apply_complete', { stats: state.stats });
    };

    document.getElementById('btn-stop').onclick = () => { state.autoRunning = false;
        document.getElementById('btn-start').style.display = 'inline-block';
        document.getElementById('btn-stop').style.display = 'none';
        panelLog("log-apply", '⏹️ 手动停止');
    };

    // ========================== v1.7.3 AI代聊（完整保留） ==========================
    function getChatListItems() { return querySelectorAllFallback(S.chatListItem); }
    function getChatId(item) { const n = querySelectorFallback(S.hrName, item); return n ? (n.innerText||'').trim() : (item.getAttribute('data-id')||''); }
    function hasUnreadBadge(item) {
        const b = querySelectorFallback(S.unreadBadge, item);
        if (b && b.offsetParent) { const t = (b.innerText||'').trim(); if (!t && b.offsetWidth>0) return true; const n=parseInt(t); if (!isNaN(n)&&n>0) return true; }
        return item.className.includes('unread')||item.className.includes('active-chat');
    }
    function isLastMsgFromHR(item) { const m = querySelectorFallback(S.lastMsgPreview, item); if (!m) return false; const t = (m.innerText||'').trim(); return t && !['已读','送达','发送中'].includes(t); }
    function currentChatNeedsReply() {
        const ms = querySelectorAllFallback(S.messageItem); if (!ms.length) return false;
        const last = ms[ms.length-1];
        if (!S.hrMsgClass.some(c => last.classList.contains(c))) return false;
        let t = (querySelectorFallback(S.msgText, last)?.innerText || last.querySelector('.message-card-wrap')?.innerText || '').replace(/^(送达|已读|未读|发送中)\s*/g,'').trim();
        if (state.lastRepliedMsg === t) return false;
        return t.length > 0;
    }

    // ⭐ 新增：发送简历PNG
    const resumeSent = new Set(JSON.parse(GM_getValue('resumeSentList','[]'))); // 已发送过简历的HR名单
    function markResumeSent(hrName) {
        resumeSent.add(hrName);
        GM_setValue('resumeSentList', JSON.stringify([...resumeSent].slice(-200)));
    }

    async function sendResumePng() {
        // 找到聊天区的文件上传input
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetInput = null;
        for (const fi of fileInputs) {
            // 优先找accept含image或在聊天区域的
            if (fi.accept && fi.accept.includes('image')) { targetInput = fi; break; }
        }
        if (!targetInput && fileInputs.length > 0) {
            // 兜底：找最近的可交互file input
            for (const fi of fileInputs) {
                if (fi.offsetParent || fi.checkVisibility?.()) { targetInput = fi; break; }
            }
        }
        if (!targetInput) {
            debugLog('未找到文件上传入口');
            return false;
        }

        try {
            // 从后端获取简历图片
            const resp = await fetch('http://127.0.0.1:8899/resume.png');
            if (!resp.ok) { debugLog('简历PNG获取失败'); return false; }
            const blob = await resp.blob();
            const file = new File([blob], 'resume.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            targetInput.files = dt.files;
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
            await sleep(2000); // 等待上传
            return true;
        } catch(e) {
            debugLog('简历发送异常:', e.message);
            return false;
        }
    }

    async function checkChatAndReply() {
        if (!state.chatRunning) return;
        if (Date.now() - state.lastReplyTime < 3000) return;

        // 当前聊天需要回复
        if (currentChatNeedsReply()) {
            const ms = querySelectorAllFallback(S.messageItem).slice(-8);
            const hist = [];
            ms.forEach(m => {
                const hr = S.hrMsgClass.some(c => m.classList.contains(c));
                let t = (querySelectorFallback(S.msgText, m)?.innerText || m.querySelector('.message-card-wrap')?.innerText || '').replace(/^(送达|已读|未读|发送中)\s*/g,'').trim();
                if (t) hist.push({ role: hr?'user':'assistant', content: t });
            });
            if (hist.length && hist[hist.length-1].role==='user') {
                state.lastReplyTime = Date.now(); state.lastRepliedMsg = hist[hist.length-1].content;
                panelLog("log-chat", 'HR: "' + state.lastRepliedMsg.substring(0,20) + '..."');
                const reply = await requestAI(hist);
                if (reply) {
                    if (await sendChatBoxMsg(reply)) { panelLog("log-chat", '✅ 已回复'); await toBackend('ai_reply', { message: reply.substring(0,100) }); await sleep(1500); return; }
                } else state.lastRepliedMsg = '';
            }
        }

        const items = getChatListItems(); if (!items.length) return;

        // 切换对话的通用处理
        const switchToChat = async (item, reason) => {
            const cid = getChatId(item);
            panelLog("log-chat", reason + ' ' + cid.substring(0,8));
            const t = querySelectorFallback(S.chatItemClickTarget, item) || item;
            await simulateClick(t);
            state.lastRepliedMsg = '';
            state.currentChatId = cid;
            await sleep(3000);

            // ⭐ 如果没给这个HR发过简历，自动发送
            if (!resumeSent.has(cid)) {
                panelLog("log-chat", '📎 发送简历...');
                const sent = await sendResumePng();
                if (sent) {
                    markResumeSent(cid);
                    panelLog("log-chat", '📎 简历已发送 ✓');
                    await toBackend('resume_sent', { hr: cid });
                    await sleep(2000);
                } else {
                    panelLog("log-chat", '⚠️ 简历发送失败，请手动发送');
                }
            }
        };

        // 红点优先
        for (const i of items) {
            if (i.className.includes('active')||i.getAttribute('aria-selected')==='true') continue;
            if (hasUnreadBadge(i)) { await switchToChat(i, '🔴'); return; }
        }
        // 待回复
        for (const i of items) {
            if (i.className.includes('active')||i.getAttribute('aria-selected')==='true') continue;
            const cid = getChatId(i); if (state.processedChats.has(cid)) continue;
            if (isLastMsgFromHR(i)) { state.processedChats.add(cid); await switchToChat(i, '💬'); return; }
        }
        if (state.processedChats.size>50) state.processedChats.clear();
    }

    document.getElementById('btn-chat').onclick = () => {
        if (!location.href.includes('/web/geek/chat')) { alert("请在BOSS【消息】页面使用！"); return; }
        state.chatRunning = true; state.processedChats.clear();
        document.getElementById('btn-chat').style.display = 'none';
        document.getElementById('btn-chat-stop').style.display = 'inline-block';
        panelLog("log-chat", '🟢 AI巡航启动');
        state.chatTimer = setInterval(checkChatAndReply, 2000);
    };
    document.getElementById('btn-chat-stop').onclick = () => {
        state.chatRunning = false;
        document.getElementById('btn-chat').style.display = 'inline-block';
        document.getElementById('btn-chat-stop').style.display = 'none';
        if (state.chatTimer) clearInterval(state.chatTimer);
        panelLog("log-chat", '🔴 已停止');
    };

    console.log('[BOSS助手 v3.1] 就绪 | 招呼语: ' + config.greetText.substring(0,25));
})();
