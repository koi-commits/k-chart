/* ============================================
   tutorial-ui.js — Game-inspired tutorial overlay
   Viral design: Peak-End, Zeigarnik, Social Currency,
   GIF-able moments, IKEA Effect, Scarcity+FOMO, Social Proof
   ============================================ */

const TutorialUI = (() => {

  // ── State ──
  let overlay = null;
  let active = false;
  let currentStepIndex = -1;
  let completedSteps = new Set();
  let totalSteps = 7;
  let particleInterval = null;
  let socialProofInterval = null;
  let stats = null;
  let uniqueTrait = '';
  let animFrameId = null;

  // ── Trait pool for shared cards ──
  const TRAITS = [
    { name: '冷静猎手', icon: '🎯', desc: '耐心等待最佳入场时机' },
    { name: '趋势先知', icon: '🔮', desc: '对市场趋势有敏锐直觉' },
    { name: '量价大师', icon: '📊', desc: '能从量价关系中嗅到机会' },
    { name: '闪电交易者', icon: '⚡', desc: '决断迅速，快进快出' },
    { name: '铁腕风控', icon: '🛡️', desc: '止损纪律严明，不贪不惧' },
    { name: '模式猎手', icon: '👁️', desc: '轻松识别各种K线形态' },
    { name: '逆势勇者', icon: '🗡️', desc: '敢于在恐慌中抄底' },
    { name: '数据忍者', icon: '🥷', desc: '用数据对抗市场情绪' },
  ];

  // ── Colors ──
  const GOLD = '#ffd700';
  const GOLD_DIM = 'rgba(255,215,0,0.6)';
  const GOLD_GLOW = 'rgba(255,215,0,0.25)';
  const ACCENT_BLUE = '#42a5f5';
  const DARK_BG = 'rgba(8,8,12,0.95)';
  const CARD_BG = 'rgba(20,20,30,0.92)';
  const BORDER_SUBTLE = 'rgba(255,255,255,0.08)';

  // ── Default content fallback (until TutorialContent loads) ──
  function getContent() {
    if (typeof TutorialContent !== 'undefined') return TutorialContent;
    return {
      steps: [
        { chapter: '第一章', title: '欢迎来到K线世界', text: '准备好开始你的交易之旅了吗？', interactive: null },
        { chapter: '第二章', title: '认识K线', text: '每根K线讲述一个价格故事。', interactive: null },
        { chapter: '第三章', title: '支撑与阻力', text: '价格在哪里反弹？在哪里受阻？', interactive: 'trendline' },
        { chapter: '第四章', title: '趋势是你的朋友', text: '识别趋势是交易的第一课。', interactive: null },
        { chapter: '第五章', title: '成交量揭秘', text: '量在价先，成交量不会说谎。', interactive: null },
        { chapter: '第六章', title: '技术指标入门', text: 'MACD、RSI — 你的交易工具箱。', interactive: null },
        { chapter: '第七章', title: '风险管理', text: '活下去，比赚得多更重要。', interactive: null },
      ],
      chapters: [
        { id: 1, name: 'K线基础', icon: '🕯️', locked: false },
        { id: 2, name: '形态识别', icon: '🔍', locked: false },
        { id: 3, name: '趋势分析', icon: '📈', locked: false },
        { id: 4, name: '量价关系', icon: '📊', locked: false },
        { id: 5, name: '技术指标', icon: '⚙️', locked: false },
        { id: 6, name: '高级策略', icon: '🔒', locked: true },
        { id: 7, name: '实战模拟', icon: '🔒', locked: true },
      ],
      finale: { title: '训练完成！', subtitle: '你已经准备好进入真实市场了', skills: ['K线阅读', '趋势判断', '风险管理'] },
    };
  }

  // ── DOM Creation ──
  function createOverlay() {
    if (overlay && document.body.contains(overlay)) return;

    overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.innerHTML = buildOverlayHTML();
    document.body.appendChild(overlay);

    bindOverlayEvents();
  }

  function buildOverlayHTML() {
    return `
      <!-- Background layer -->
      <div class="tut-bg" id="tutBg"></div>

      <!-- Floating particles canvas -->
      <canvas class="tut-particles" id="tutParticles"></canvas>

      <!-- Progress bar (Zeigarnik Effect) -->
      <div class="tut-progress-wrap">
        <div class="tut-progress-track">
          <div class="tut-progress-fill" id="tutProgressFill" style="width:0%"></div>
        </div>
        <div class="tut-progress-text" id="tutProgressText">0/${totalSteps}</div>
      </div>

      <!-- Skip button -->
      <button class="tut-skip-btn" id="tutSkipBtn" title="跳过教程">✕</button>

      <!-- Chapter indicator -->
      <div class="tut-chapter-tag" id="tutChapterTag"></div>

      <!-- Main content area -->
      <div class="tut-main-stage" id="tutMainStage">

        <!-- Welcome screen -->
        <div class="tut-screen tut-welcome" id="tutWelcome">
          <div class="tut-welcome-logo">
            <span class="tut-logo-icon">📈</span>
            <h1 class="tut-welcome-title">K线模拟器</h1>
            <p class="tut-welcome-subtitle">交易大师之路</p>
          </div>
          <div class="tut-welcome-glitch" id="tutGlitchText">READY TO TRADE?</div>
          <p class="tut-welcome-desc">7步掌握K线交易基础，从零到交易</p>
          <div class="tut-social-proof" id="tutSocialProof">
            <span class="tut-social-icon">👥</span>
            <span id="tutSocialCount">32,847</span> 位交易者已完成此教程
          </div>
          <button class="tut-btn tut-btn-primary tut-btn-large tut-pulse" id="tutBtnStart">
            <span>开始训练</span>
            <span class="tut-btn-arrow">→</span>
          </button>
        </div>

        <!-- Step screen -->
        <div class="tut-screen tut-step-screen" id="tutStepScreen" style="display:none">
          <div class="tut-step-header">
            <h2 class="tut-step-chapter" id="tutStepChapter"></h2>
            <h3 class="tut-step-title" id="tutStepTitle"></h3>
          </div>
          <div class="tut-step-body">
            <div class="tut-step-text" id="tutStepText"></div>
            <div class="tut-interactive-zone" id="tutInteractiveZone"></div>
          </div>
          <div class="tut-step-actions">
            <button class="tut-btn tut-btn-ghost" id="tutBtnPrev">← 上一步</button>
            <button class="tut-btn tut-btn-primary tut-pulse" id="tutBtnNext">
              <span id="tutBtnNextLabel">下一步</span>
              <span class="tut-btn-arrow">→</span>
            </button>
          </div>
          <!-- Step dots (Zeigarnik) -->
          <div class="tut-step-dots" id="tutStepDots"></div>
        </div>

        <!-- Chapter select screen -->
        <div class="tut-screen tut-chapter-screen" id="tutChapterScreen" style="display:none">
          <h2 class="tut-chapter-screen-title">选择章节</h2>
          <div class="tut-chapter-grid" id="tutChapterGrid"></div>
          <button class="tut-btn tut-btn-ghost" id="tutBtnBackFromChapters">← 返回</button>
        </div>

        <!-- Finale screen (Peak-End Rule) -->
        <div class="tut-screen tut-finale-screen" id="tutFinaleScreen" style="display:none">
          <div class="tut-finale-fireworks" id="tutFireworks"></div>
          <div class="tut-finale-content">
            <div class="tut-finale-badge">🏆</div>
            <h1 class="tut-finale-title">训练完成！</h1>
            <p class="tut-finale-subtitle" id="tutFinaleSubtitle"></p>

            <!-- Stats summary (Peak-End) -->
            <div class="tut-finale-stats" id="tutFinaleStats"></div>

            <!-- Shareable Trader Profile Card (Social Currency) -->
            <div class="tut-share-card-wrap">
              <div class="tut-share-card" id="tutShareCard">
                <div class="tut-share-card-inner">
                  <div class="tut-share-card-header">
                    <span class="tut-share-card-icon">📈</span>
                    <span class="tut-share-card-brand">K线模拟器</span>
                  </div>
                  <div class="tut-share-card-body">
                    <div class="tut-share-card-level">TRADER LEVEL</div>
                    <div class="tut-share-card-rank">APPRENTICE</div>
                    <div class="tut-share-card-divider"></div>
                    <div class="tut-share-card-skills" id="tutShareSkills"></div>
                    <div class="tut-share-card-trait" id="tutShareTrait"></div>
                  </div>
                  <div class="tut-share-card-footer">
                    <span>已完成新手教程</span>
                    <span class="tut-share-card-date" id="tutShareDate"></span>
                  </div>
                </div>
                <div class="tut-share-card-glow"></div>
              </div>
            </div>

            <div class="tut-finale-actions">
              <button class="tut-btn tut-btn-primary tut-btn-large" id="tutBtnFinish">
                <span>开始交易</span>
                <span class="tut-btn-arrow">→</span>
              </button>
              <button class="tut-btn tut-btn-outline" id="tutBtnShare">
                <span>📋 复制分享卡</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- GIF-able candlestick animation (corner decoration) -->
      <div class="tut-corner-candles" id="tutCornerCandles" aria-hidden="true">
        <div class="tut-candle tut-candle-up"></div>
        <div class="tut-candle tut-candle-down"></div>
        <div class="tut-candle tut-candle-up"></div>
        <div class="tut-candle tut-candle-down"></div>
        <div class="tut-candle tut-candle-up"></div>
      </div>
    `;
  }

  function bindOverlayEvents() {
    const $ = (s) => overlay.querySelector(s);

    // Start button
    $('.tut-welcome').addEventListener('click', (e) => {
      if (e.target.closest('#tutBtnStart')) {
        /* SOUND: ui_click */
        showStep(0);
      }
    });

    // Step navigation
    $('#tutBtnNext').addEventListener('click', () => {
      /* SOUND: ui_click */
      if (currentStepIndex < totalSteps - 1) {
        completeStep(currentStepIndex);
        showStep(currentStepIndex + 1);
      } else {
        // Last step → finale
        completeStep(currentStepIndex);
        showFinale(stats || {});
      }
    });

    $('#tutBtnPrev').addEventListener('click', () => {
      if (currentStepIndex > 0) {
        showStep(currentStepIndex - 1);
      } else {
        showWelcome();
      }
    });

    // Skip
    $('#tutSkipBtn').addEventListener('click', () => {
      hide();
    });

    // Chapter select back
    $('#tutBtnBackFromChapters').addEventListener('click', () => {
      showWelcome();
    });

    // Finale buttons
    $('#tutBtnFinish').addEventListener('click', () => {
      hide();
    });

    $('#tutBtnShare').addEventListener('click', () => {
      copyShareCard();
    });

    // Keyboard navigation
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (!active) return;
    if (e.key === 'Escape') { hide(); return; }
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      const nextBtn = overlay.querySelector('#tutBtnNext');
      if (nextBtn && nextBtn.offsetParent) nextBtn.click();
    }
    if (e.key === 'ArrowLeft') {
      const prevBtn = overlay.querySelector('#tutBtnPrev');
      if (prevBtn && prevBtn.offsetParent) prevBtn.click();
    }
  }

  // ── Screen Management ──
  function showScreen(screenId) {
    const screens = overlay.querySelectorAll('.tut-screen');
    screens.forEach(s => { s.style.display = 'none'; s.classList.remove('tut-screen-enter'); });
    const target = overlay.querySelector(screenId);
    if (target) {
      target.style.display = '';
      // Animate entrance
      requestAnimationFrame(() => {
        target.classList.add('tut-screen-enter');
      });
    }
  }

  function showWelcome() {
    currentStepIndex = -1;
    showScreen('#tutWelcome');
    updateProgress(0);
    const tag = overlay.querySelector('#tutChapterTag');
    if (tag) tag.style.display = 'none';
    const prevBtn = overlay.querySelector('#tutBtnPrev');
    if (prevBtn) prevBtn.style.display = 'none';
  }

  function hideAllScreens() {
    overlay.querySelectorAll('.tut-screen').forEach(s => s.style.display = 'none');
  }

  // ── Public API ──

  /**
   * Initialize the tutorial overlay.
   * Creates DOM, starts background particles, shows welcome.
   */
  function init() {
    if (overlay && document.body.contains(overlay)) return;
    createOverlay();
    active = true;
    completedSteps.clear();
    currentStepIndex = -1;
    stats = null;
    uniqueTrait = TRAITS[Math.floor(Math.random() * TRAITS.length)];

    // Render chapter grid
    renderChapterGrid();

    // Start particles
    startParticles();

    // Start social proof counter update
    startSocialProofCounter();

    // Show welcome screen
    showWelcome();

    // Render step dots
    renderStepDots();

    // Start corner candle animation
    setTimeout(animateCornerCandles, 500);

    /* SOUND: tutorial_open */
  }

  /**
   * Show a specific step with slide transition.
   * @param {number} n - Zero-based step index
   */
  function showStep(n) {
    if (!overlay || !active) return;
    if (n < 0 || n >= totalSteps) return;

    const prev = currentStepIndex;
    currentStepIndex = n;
    const content = getContent();
    const step = content.steps[n];

    hideAllScreens();
    const stepScreen = overlay.querySelector('#tutStepScreen');
    if (stepScreen) stepScreen.style.display = '';

    // Chapter tag
    const tag = overlay.querySelector('#tutChapterTag');
    if (tag) {
      tag.style.display = '';
      tag.textContent = step.chapter || `第${n + 1}章`;
    }

    // Fill content
    const chapterEl = overlay.querySelector('#tutStepChapter');
    const titleEl = overlay.querySelector('#tutStepTitle');
    const textEl = overlay.querySelector('#tutStepText');
    const interactiveZone = overlay.querySelector('#tutInteractiveZone');

    if (chapterEl) chapterEl.textContent = step.chapter || `第${n + 1}章`;
    if (titleEl) titleEl.textContent = step.title || '';
    if (textEl) textEl.innerHTML = step.text || '';

    // Interactive zone (IKEA Effect)
    if (interactiveZone) {
      interactiveZone.innerHTML = '';
      var it = step.interactive;
      // Support both string types (legacy) and object types (from tutorial-content.js)
      var itType = typeof it === 'string' ? it : (it && it.type ? it.type : null);
      if (itType === 'trendline') {
        buildTrendlineInteractive(interactiveZone);
      } else if (itType === 'pattern') {
        buildPatternInteractive(interactiveZone);
      } else if (itType === 'slider') {
        buildSliderInteractive(interactiveZone, step);
      } else if (itType === 'observe' || itType === 'action') {
        // Content-driven interactive: show hint/target info
        var hintText = (it && it.hint) || '观察图表中高亮标注的区域';
        var targetEl = (it && it.target) ? document.querySelector(it.target) : null;
        if (targetEl) {
          try { targetEl.style.outline = '2px solid var(--accent)'; targetEl.style.outlineOffset = '2px';
            setTimeout(function(){ try { targetEl.style.outline=''; targetEl.style.outlineOffset=''; } catch(e){} }, 8000);
          } catch(e) {}
        }
        interactiveZone.innerHTML = '<div class="tut-interactive-hint"><span style="font-size:32px">👆</span><p style="margin-top:8px;color:var(--text-secondary);font-size:13px">' + hintText + '</p></div>';
      } else {
        interactiveZone.innerHTML = '<div class="tut-interactive-hint"><p style="color:var(--text-muted)">📖 阅读并理解以上内容，然后点击下一步</p></div>';
      }
    }

    // Next button label
    const nextLabel = overlay.querySelector('#tutBtnNextLabel');
    if (nextLabel) {
      nextLabel.textContent = (n === totalSteps - 1) ? '完成训练' : '下一步';
    }

    // Prev button visibility
    const prevBtn = overlay.querySelector('#tutBtnPrev');
    if (prevBtn) {
      prevBtn.style.display = n === 0 ? 'none' : '';
    }

    // Animate transition direction
    if (stepScreen) {
      const direction = n > prev ? 'right' : 'left';
      stepScreen.style.setProperty('--slide-dir', direction === 'right' ? '30px' : '-30px');
      stepScreen.classList.remove('tut-screen-enter');
      requestAnimationFrame(() => {
        stepScreen.classList.add('tut-screen-enter');
      });
    }

    updateProgress(n);
    updateStepDots(n);
    renderStepDots();

    // Scroll text to top
    if (textEl) textEl.scrollTop = 0;

    /* SOUND: step_transition */
  }

  /**
   * Mark a step as complete with checkmark animation.
   * @param {number} n - Zero-based step index
   */
  function completeStep(n) {
    completedSteps.add(n);
    updateProgress(n + 1);
    animateStepDotComplete(n);

    /* SOUND: step_complete */
  }

  /**
   * Show the chapter select grid.
   */
  function showChapterSelect() {
    if (!overlay || !active) return;
    hideAllScreens();
    const screen = overlay.querySelector('#tutChapterScreen');
    if (screen) {
      screen.style.display = '';
      screen.classList.remove('tut-screen-enter');
      requestAnimationFrame(() => screen.classList.add('tut-screen-enter'));
    }
    renderChapterGrid();
    /* SOUND: page_flip */
  }

  /**
   * Show the finale screen with stats and share card.
   * @param {Object} finalStats - User's training stats
   */
  function showFinale(finalStats) {
    if (!overlay || !active) return;
    stats = finalStats || {};
    hideAllScreens();

    const screen = overlay.querySelector('#tutFinaleScreen');
    if (!screen) return;

    screen.style.display = '';
    screen.classList.remove('tut-screen-enter');
    requestAnimationFrame(() => screen.classList.add('tut-screen-enter'));

    const content = getContent();
    const finale = content.finale;

    // Fill subtitle
    const subtitleEl = overlay.querySelector('#tutFinaleSubtitle');
    if (subtitleEl) subtitleEl.textContent = finale.subtitle || '你已经准备好进入真实市场了';

    // Build stats grid
    const statsEl = overlay.querySelector('#tutFinaleStats');
    if (statsEl) {
      const timeSpent = stats.timeSpent || Math.floor(Math.random() * 15 + 5) + '分钟';
      const totalCompleted = completedSteps.size;
      const accuracy = stats.accuracy || Math.floor(Math.random() * 20 + 75) + '%';

      statsEl.innerHTML = `
        <div class="tut-stat-card">
          <div class="tut-stat-value">${totalCompleted}/${totalSteps}</div>
          <div class="tut-stat-label">完成步骤</div>
        </div>
        <div class="tut-stat-card">
          <div class="tut-stat-value">${timeSpent}</div>
          <div class="tut-stat-label">训练时长</div>
        </div>
        <div class="tut-stat-card">
          <div class="tut-stat-value">${accuracy}</div>
          <div class="tut-stat-label">理解准确率</div>
        </div>
      `;
    }

    // Build share card skills
    const skillsEl = overlay.querySelector('#tutShareSkills');
    if (skillsEl) {
      const skills = finale.skills || getContent().steps.filter((_, i) => completedSteps.has(i)).map(s => s.title).slice(0, 5);
      skillsEl.innerHTML = skills.map(s => `<span class="tut-skill-tag">${s}</span>`).join('');
    }

    // Trait
    const traitEl = overlay.querySelector('#tutShareTrait');
    if (traitEl) {
      traitEl.innerHTML = `
        <div class="tut-trait-icon">${uniqueTrait.icon}</div>
        <div class="tut-trait-name">${uniqueTrait.name}</div>
        <div class="tut-trait-desc">${uniqueTrait.desc}</div>
      `;
    }

    // Date
    const dateEl = overlay.querySelector('#tutShareDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Launch fireworks particles
    spawnFinaleParticles();

    /* SOUND: achievement_chime */
  }

  /**
   * Hide the tutorial overlay.
   */
  function hide() {
    if (!overlay) return;
    active = false;
    currentStepIndex = -1;

    // Animate out
    overlay.style.transition = 'opacity 0.3s ease-out';
    overlay.style.opacity = '0';
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      overlay = null;
      stopParticles();
      stopSocialProofCounter();
      document.removeEventListener('keydown', onKeydown);
    }, 350);

    /* SOUND: ui_close */
  }

  /**
   * Returns whether the tutorial is currently active.
   */
  function isActive() {
    return active && overlay !== null && document.body.contains(overlay);
  }

  // ── Progress Bar (Zeigarnik Effect) ──
  function updateProgress(completed) {
    const pct = Math.round((completed / totalSteps) * 100);
    const fill = overlay.querySelector('#tutProgressFill');
    const text = overlay.querySelector('#tutProgressText');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = completed + '/' + totalSteps;

    // Flash effect when progress changes
    if (fill) {
      fill.classList.add('tut-progress-flash');
      setTimeout(() => fill.classList.remove('tut-progress-flash'), 400);
    }
  }

  // ── Step Dots ──
  function renderStepDots() {
    const container = overlay.querySelector('#tutStepDots');
    if (!container) return;
    let html = '';
    for (let i = 0; i < totalSteps; i++) {
      const cls = completedSteps.has(i) ? 'complete' : (i === currentStepIndex ? 'active' : '');
      html += `<span class="tut-dot tut-dot-${cls}" data-step="${i}"></span>`;
    }
    container.innerHTML = html;

    // Click to navigate
    container.querySelectorAll('.tut-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const s = parseInt(dot.dataset.step);
        if (completedSteps.has(s) || s <= Math.max(...completedSteps, 0) + 1) {
          showStep(s);
        }
      });
    });
  }

  function updateStepDots(n) {
    const dots = overlay.querySelectorAll('.tut-dot');
    dots.forEach((d, i) => {
      d.className = 'tut-dot tut-dot-' + (
        completedSteps.has(i) ? 'complete' : (i === n ? 'active' : '')
      );
    });
  }

  function animateStepDotComplete(n) {
    const dots = overlay.querySelectorAll('.tut-dot');
    if (dots[n]) {
      dots[n].classList.add('tut-dot-completing');
      setTimeout(() => dots[n].classList.remove('tut-dot-completing'), 600);
    }
  }

  // ── Chapter Grid (Scarcity + FOMO) ──
  function renderChapterGrid() {
    const grid = overlay.querySelector('#tutChapterGrid');
    if (!grid) return;
    const content = getContent();
    const chapters = content.chapters || [];

    let html = '';
    chapters.forEach((ch, i) => {
      const isUnlocked = !ch.locked || completedSteps.size >= (i * 2);
      const isLocked = ch.locked && completedSteps.size < (i * 2);
      const isCompleted = !ch.locked && completedSteps.size >= totalSteps;
      const cls = isLocked ? 'locked' : (isCompleted ? 'completed' : 'unlocked');

      html += `
        <div class="tut-chapter-card tut-chapter-${cls}" data-chapter="${ch.id || i}">
          <div class="tut-chapter-card-icon">${isLocked ? '🔒' : (ch.icon || '📖')}</div>
          <div class="tut-chapter-card-name">${ch.name || '章节 ' + (i + 1)}</div>
          ${isLocked ? '<div class="tut-chapter-card-lock-hint">完成前置章节解锁</div>' : ''}
          ${isLocked && i >= 4 ? '<div class="tut-chapter-card-sparkle">✦</div>' : ''}
          ${!isLocked && isCompleted ? '<div class="tut-chapter-card-check">✓</div>' : ''}
          <div class="tut-chapter-card-shine"></div>
        </div>
      `;
    });

    grid.innerHTML = html;

    // Click handlers
    grid.querySelectorAll('.tut-chapter-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        const chId = parseInt(card.dataset.chapter);
        /* SOUND: chapter_select */
        // Map chapter to step index (each chapter = ~1 step for now)
        showStep(Math.min(chId - 1, totalSteps - 1));
      });
    });

    // Locked cards shake on click
    grid.querySelectorAll('.tut-chapter-card.locked').forEach(card => {
      card.addEventListener('click', () => {
        card.classList.add('tut-shake');
        /* SOUND: ui_locked */
        setTimeout(() => card.classList.remove('tut-shake'), 500);
      });
    });
  }

  // ── Interactive Builders (IKEA Effect) ──
  function buildTrendlineInteractive(container) {
    container.innerHTML = `
      <div class="tut-ikea-area" id="tutTrendlineArea">
        <div class="tut-ikea-hint">👆 在图表上点击两个点来画一条趋势线</div>
        <canvas class="tut-ikea-canvas" id="tutTrendCanvas" width="320" height="180"></canvas>
        <div class="tut-ikea-feedback" id="tutTrendFeedback"></div>
      </div>
    `;

    const canvas = container.querySelector('#tutTrendCanvas');
    const feedback = container.querySelector('#tutTrendFeedback');
    let clicks = [];

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      clicks.push({ x, y });

      const ctx = canvas.getContext('2d');
      drawTrendlineCanvas(ctx, canvas.width, canvas.height, clicks);

      if (clicks.length === 1) {
        feedback.innerHTML = '<span class="tut-ikea-success">很好！再点一个点完成趋势线</span>';
      } else if (clicks.length === 2) {
        feedback.innerHTML = '<span class="tut-ikea-success">✓ 趋势线绘制完成！你学会了画趋势线</span>';
        /* SOUND: ikea_complete */
        setTimeout(() => {
          clicks = [];
          const ctx2 = canvas.getContext('2d');
          ctx2.clearRect(0, 0, canvas.width, canvas.height);
          drawChartBg(ctx2, canvas.width, canvas.height);
          feedback.innerHTML = '<span class="tut-ikea-hint">👆 点击重置再画一次</span>';
        }, 2500);
      }
    });

    // Draw background chart
    const ctx = canvas.getContext('2d');
    drawChartBg(ctx, canvas.width, canvas.height);
  }

  function drawChartBg(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 8; i++) {
      const y = (h / 8) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Fake price line
    ctx.strokeStyle = 'rgba(66,165,245,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, h * 0.7);
    ctx.lineTo(60, h * 0.55);
    ctx.lineTo(90, h * 0.6);
    ctx.lineTo(120, h * 0.35);
    ctx.lineTo(160, h * 0.4);
    ctx.lineTo(200, h * 0.2);
    ctx.lineTo(240, h * 0.3);
    ctx.lineTo(270, h * 0.15);
    ctx.lineTo(300, h * 0.25);
    ctx.stroke();
  }

  function drawTrendlineCanvas(ctx, w, h, clicks) {
    drawChartBg(ctx, w, h);
    // Draw click points
    clicks.forEach(p => {
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    // Draw line if 2 points
    if (clicks.length === 2) {
      // Extend line
      const dx = clicks[1].x - clicks[0].x;
      const dy = clicks[1].y - clicks[0].y;
      const extStart = { x: clicks[0].x - dx * 5, y: clicks[0].y - dy * 5 };
      const extEnd = { x: clicks[1].x + dx * 5, y: clicks[1].y + dy * 5 };

      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(extStart.x, extStart.y);
      ctx.lineTo(extEnd.x, extEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function buildPatternInteractive(container) {
    container.innerHTML = `
      <div class="tut-ikea-area">
        <div class="tut-ikea-hint">👆 点击你认为正确的K线形态</div>
        <div class="tut-pattern-choices">
          <button class="tut-pattern-btn" data-pattern="hammer">🔨 锤子线</button>
          <button class="tut-pattern-btn" data-pattern="doji">✚ 十字星</button>
          <button class="tut-pattern-btn" data-pattern="engulf">🔥 吞没形态</button>
        </div>
        <div class="tut-ikea-feedback" id="tutPatternFeedback"></div>
      </div>
    `;

    container.querySelectorAll('.tut-pattern-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        const fb = container.querySelector('#tutPatternFeedback');
        // All correct for tutorial
        btn.classList.add('tut-pattern-selected');
        fb.innerHTML = '<span class="tut-ikea-success">✓ 正确！' + btn.textContent.trim() + '是常见反转信号</span>';
        /* SOUND: ikea_complete */
        setTimeout(() => {
          container.querySelectorAll('.tut-pattern-btn').forEach(b => b.classList.remove('tut-pattern-selected'));
          fb.innerHTML = '';
        }, 2000);
      });
    });
  }

  function buildSliderInteractive(container, step) {
    const min = step.sliderMin || 0;
    const max = step.sliderMax || 100;
    const val = step.sliderDefault || 50;
    container.innerHTML = `
      <div class="tut-ikea-area">
        <div class="tut-ikea-hint">🎚️ 拖动滑块设置你的风险承受度</div>
        <div class="tut-slider-wrap">
          <input type="range" class="tut-slider" id="tutIkeaSlider" min="${min}" max="${max}" value="${val}">
          <div class="tut-slider-labels">
            <span>保守</span>
            <span>平衡</span>
            <span>激进</span>
          </div>
        </div>
        <div class="tut-ikea-feedback" id="tutSliderFeedback">
          <span class="tut-ikea-success">当前: ${val}% — 适合稳健型交易者</span>
        </div>
      </div>
    `;

    const slider = container.querySelector('#tutIkeaSlider');
    const fb = container.querySelector('#tutSliderFeedback');
    if (slider && fb) {
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value);
        const style = v < 30 ? '保守型' : (v < 70 ? '平衡型' : '激进型');
        fb.innerHTML = `<span class="tut-ikea-success">当前: ${v}% — ${style}交易风格</span>`;
      });
    }
  }

  // ── Particles ──
  function startParticles() {
    const canvas = overlay ? overlay.querySelector('#tutParticles') : null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    const MAX = 35;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function createParticle() {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4 - 0.3,
        opacity: Math.random() * 0.5 + 0.1,
        color: Math.random() < 0.3 ? GOLD : ACCENT_BLUE,
        life: Math.random() * 200 + 100,
        maxLife: 300,
      };
    }

    for (let i = 0; i < MAX; i++) {
      particles.push(createParticle());
      particles[i].life = Math.random() * particles[i].maxLife;
    }

    function animate() {
      if (!active || !overlay || !document.body.contains(overlay)) {
        particles = [];
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'screen';

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        // Wrap around
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;

        // Respawn dead particles
        if (p.life <= 0) {
          particles[i] = createParticle();
          particles[i].life = particles[i].maxLife;
        }

        const alpha = (p.life / p.maxLife) * p.opacity;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;

        // Glow
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        glow.addColorStop(0, p.color);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
      });

      animFrameId = requestAnimationFrame(animate);
    }

    animate();
  }

  function stopParticles() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function spawnFinaleParticles() {
    const container = overlay.querySelector('#tutFireworks');
    if (!container) return;

    const colors = [GOLD, '#ff5252', ACCENT_BLUE, '#66bb6a', '#c084fc', '#fff'];
    for (let i = 0; i < 60; i++) {
      const particle = document.createElement('div');
      const color = colors[Math.floor(Math.random() * colors.length)];
      const x = Math.random() * 100;
      const delay = Math.random() * 0.8;
      const duration = 1 + Math.random() * 2;
      const size = 3 + Math.random() * 8;

      particle.className = 'tut-firework-particle';
      particle.style.cssText = `
        left: ${x}%;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        animation: tutFirework ${duration}s ease-out ${delay}s forwards;
      `;
      container.appendChild(particle);
      setTimeout(() => particle.remove(), (duration + delay) * 1000 + 200);
    }

    /* SOUND: finale_fireworks */
  }

  // ── Social Proof Counter ──
  function startSocialProofCounter() {
    let base = 32847;
    const el = overlay.querySelector('#tutSocialCount');
    if (!el) return;

    el.textContent = base.toLocaleString();

    socialProofInterval = setInterval(() => {
      base += Math.floor(Math.random() * 5) + 1;
      el.textContent = base.toLocaleString();
      // Subtle flash
      el.style.color = GOLD;
      setTimeout(() => el.style.color = '', 200);
    }, 8000 + Math.random() * 4000);
  }

  function stopSocialProofCounter() {
    if (socialProofInterval) {
      clearInterval(socialProofInterval);
      socialProofInterval = null;
    }
  }

  // ── Corner Candle Animation (GIF-able) ──
  function animateCornerCandles() {
    const container = overlay.querySelector('#tutCornerCandles');
    if (!container) return;

    const candles = container.querySelectorAll('.tut-candle');
    candles.forEach((candle, i) => {
      setTimeout(() => {
        candle.classList.add('tut-candle-lit');
      }, i * 400);
    });

    // Loop
    setInterval(() => {
      candles.forEach(c => c.classList.remove('tut-candle-lit'));
      candles.forEach((candle, i) => {
        setTimeout(() => candle.classList.add('tut-candle-lit'), i * 400);
      });
    }, 6000);
  }

  // ── Share Card Copy ──
  function copyShareCard() {
    const card = overlay.querySelector('#tutShareCard');
    if (!card) return;

    // Use html2canvas approach: create a temporary canvas from card HTML
    // For simplicity, copy text representation
    const skills = Array.from(card.querySelectorAll('.tut-skill-tag')).map(s => s.textContent).join(', ');
    const traitName = card.querySelector('.tut-trait-name')?.textContent || '';
    const traitDesc = card.querySelector('.tut-trait-desc')?.textContent || '';

    const shareText = `📈 K线模拟器 — 交易大师训练完成！\n\n` +
      `🏅 Trader Level: APPRENTICE\n` +
      `🎯 特质: ${traitName} — ${traitDesc}\n` +
      `📚 已掌握: ${skills}\n` +
      `📅 ${new Date().toLocaleDateString('zh-CN')}\n\n` +
      `你也来试试: [K线模拟器]`;

    navigator.clipboard.writeText(shareText).then(() => {
      showMiniToast('已复制分享卡到剪贴板！');
      /* SOUND: share_copied */
    }).catch(() => {
      showMiniToast('复制失败，请尝试截图分享');
    });
  }

  function showMiniToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'tut-mini-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('tut-mini-toast-show'));
    setTimeout(() => {
      toast.classList.remove('tut-mini-toast-show');
      setTimeout(() => toast.remove(), 400);
    }, 2000);
  }

  // ── Public: Add interactive callback ──
  let interactiveCallback = null;

  function onInteractive(cb) {
    interactiveCallback = cb;
  }

  // ── Public API ──
  return {
    init,
    showStep,
    completeStep,
    showChapterSelect,
    showFinale,
    hide,
    isActive,
    onInteractive,
    getCompletedSteps: () => completedSteps,
    getTotalSteps: () => totalSteps,
    setTotalSteps: (n) => { totalSteps = n; },
  };
})();
