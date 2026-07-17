/* ============================================
   patterns.js — K线形态识别（日本蜡烛图技术）
   检测15+种经典蜡烛图形态，纯数学计算
   ============================================ */

const PatternDetector = (() => {

  // ────── 所有支持的形态列表 ──────
  var PATTERN_LIST = [
    { id: 'doji',              name: '十字星',       type: 'neutral' },
    { id: 'dragonfly_doji',    name: '蜻蜓十字',     type: 'reversal-bull' },
    { id: 'gravestone_doji',   name: '墓碑十字',     type: 'reversal-bear' },
    { id: 'hammer',            name: '锤子线',       type: 'reversal-bull' },
    { id: 'inverted_hammer',   name: '倒锤子线',     type: 'reversal-bull' },
    { id: 'shooting_star',     name: '流星线',       type: 'reversal-bear' },
    { id: 'hanging_man',       name: '吊颈线',       type: 'reversal-bear' },
    { id: 'marubozu_bull',     name: '光头光脚阳线', type: 'bullish' },
    { id: 'marubozu_bear',     name: '光头光脚阴线', type: 'bearish' },
    { id: 'spinning_top',      name: '纺锤线',       type: 'neutral' },
    { id: 'bullish_engulfing', name: '看涨吞没',     type: 'bullish' },
    { id: 'bearish_engulfing', name: '看跌吞没',     type: 'bearish' },
    { id: 'piercing_line',     name: '刺透形态',     type: 'bullish' },
    { id: 'dark_cloud_cover',  name: '乌云盖顶',     type: 'bearish' },
    { id: 'harami_bull',       name: '看涨孕线',     type: 'bullish' },
    { id: 'harami_bear',       name: '看跌孕线',     type: 'bearish' },
    { id: 'morning_star',      name: '启明星',       type: 'reversal-bull' },
    { id: 'evening_star',      name: '黄昏星',       type: 'reversal-bear' },
    { id: 'three_white_soldiers', name: '红三兵',    type: 'bullish' },
    { id: 'three_black_crows',    name: '三只乌鸦',  type: 'bearish' },
  ];

  // ────── 基础计算函数 ──────

  /**
   * 计算单根K线的基础指标
   * @returns {object} { body, totalRange, upperShadow, lowerShadow, bodyPct, isBull, isBear, mid }
   */
  function candleMetrics(c) {
    var open = c.open, close = c.close, high = c.high, low = c.low;
    var body = Math.abs(close - open);
    var totalRange = high - low;
    var upperShadow = high - Math.max(open, close);
    var lowerShadow = Math.min(open, close) - low;

    // 防止除零：如果 totalRange 极小（一字板、停牌等）
    if (totalRange < 0.001 && totalRange > -0.001) {
      totalRange = 0;
    }

    var bodyPct = totalRange > 0 ? body / totalRange : 0;
    var upperPct = totalRange > 0 ? upperShadow / totalRange : 0;
    var lowerPct = totalRange > 0 ? lowerShadow / totalRange : 0;

    return {
      body: body,
      totalRange: totalRange,
      upperShadow: upperShadow,
      lowerShadow: lowerShadow,
      bodyPct: bodyPct,
      upperPct: upperPct,
      lowerPct: lowerPct,
      isBull: close > open,
      isBear: close < open,
      mid: (open + close) / 2,
      isFlat: totalRange < 0.001
    };
  }

  /**
   * 检查前N根K线的趋势（用于确认反转形态的背景）
   * @returns {object} { bullCount, bearCount, avgReturn, direction }
   */
  function checkTrend(candles, index, lookback) {
    if (index < lookback) {
      return { bullCount: 0, bearCount: 0, direction: 'unknown', avgReturn: 0 };
    }

    var bullCount = 0, bearCount = 0;
    var returns = [];

    for (var i = index - lookback; i < index; i++) {
      var m = candleMetrics(candles[i]);
      if (m.isBull) bullCount++;
      if (m.isBear) bearCount++;
      if (i > index - lookback) {
        returns.push(candles[i].close - candles[i - 1].close);
      }
    }

    var avgReturn = 0;
    if (returns.length > 0) {
      var sum = 0;
      for (var r = 0; r < returns.length; r++) sum += returns[r];
      avgReturn = sum / returns.length;
    }

    var direction = 'neutral';
    if (bearCount > bullCount * 1.5) direction = 'downtrend';
    else if (bullCount > bearCount * 1.5) direction = 'uptrend';

    return {
      bullCount: bullCount,
      bearCount: bearCount,
      direction: direction,
      avgReturn: avgReturn
    };
  }

  // ────── 单根K线形态 ──────

  /**
   * 十字星 (Doji) — 实体占整个波幅 < 5%
   * 开盘价 ≈ 收盘价，市场犹豫不决
   */
  function detectDoji(candles, index) {
    if (index < 0) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null; // 一字板不算十字星
    if (m.bodyPct < 0.05 && m.totalRange > 0) {
      return {
        pattern: 'doji',
        name: '十字星',
        type: 'neutral',
        index: index,
        time: candles[index].time,
        confidence: Math.min(1.0, (0.05 - m.bodyPct) / 0.05),
        description: '开盘价与收盘价几乎相同，市场多空力量均衡，可能预示趋势反转'
      };
    }
    return null;
  }

  /**
   * 蜻蜓十字 (Dragonfly Doji) — 十字星 + 长下影 >> 短上影
   * 下影线长度 >= 总范围的 60%，上影线 < 总范围的 5%
   */
  function detectDragonflyDoji(candles, index) {
    if (index < 0) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var lowerPct = m.totalRange > 0 ? m.lowerShadow / m.totalRange : 0;
    var upperPct = m.totalRange > 0 ? m.upperShadow / m.totalRange : 0;

    // 实体小 + 长下影 + 短上影
    if (m.bodyPct < 0.1 && lowerPct >= 0.6 && upperPct < 0.05) {
      var trend = checkTrend(candles, index, 5);
      var confidence = Math.min(1.0, lowerPct);
      if (trend.direction === 'downtrend') confidence = Math.min(1.0, confidence * 1.2);
      return {
        pattern: 'dragonfly_doji',
        name: '蜻蜓十字',
        type: 'reversal-bull',
        index: index,
        time: candles[index].time,
        confidence: confidence,
        description: '价格探底后回升至开盘价附近，下方买盘强劲，可能预示见底反转'
      };
    }
    return null;
  }

  /**
   * 墓碑十字 (Gravestone Doji) — 十字星 + 长上影 >> 短下影
   * 上影线长度 >= 总范围的 60%，下影线 < 总范围的 5%
   */
  function detectGravestoneDoji(candles, index) {
    if (index < 0) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var upperPct = m.totalRange > 0 ? m.upperShadow / m.totalRange : 0;
    var lowerPct = m.totalRange > 0 ? m.lowerShadow / m.totalRange : 0;

    if (m.bodyPct < 0.1 && upperPct >= 0.6 && lowerPct < 0.05) {
      var trend = checkTrend(candles, index, 5);
      var confidence = Math.min(1.0, upperPct);
      if (trend.direction === 'uptrend') confidence = Math.min(1.0, confidence * 1.2);
      return {
        pattern: 'gravestone_doji',
        name: '墓碑十字',
        type: 'reversal-bear',
        index: index,
        time: candles[index].time,
        confidence: confidence,
        description: '价格冲高后回落至开盘价附近，上方抛压沉重，可能预示见顶反转'
      };
    }
    return null;
  }

  /**
   * 锤子线 (Hammer) — 小实体在上端 + 长下影 >= 2×实体，出现在下降趋势中
   * 实体位于K线上半部（上影很短），下影线 >= 实体×2
   */
  function detectHammer(candles, index) {
    if (index < 5) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var trend = checkTrend(candles, index, 5);
    // 必须出现在下降趋势中
    if (trend.direction !== 'downtrend') return null;

    // 小实体在顶部区域（实体的中点在上1/3区域）
    var bodyTop = Math.max(candles[index].open, candles[index].close);
    var bodyBottom = Math.min(candles[index].open, candles[index].close);
    var bodyCenter = (bodyTop + bodyBottom) / 2;
    var upperThird = bodyBottom + m.totalRange * 0.67;

    // 实体必须在上1/3区域
    if (bodyCenter < upperThird) return null;

    // 下影线 >= 实体的2倍且 >= 总范围的40%
    if (m.lowerShadow >= m.body * 2 && m.body > 0 && (m.lowerShadow / m.totalRange) >= 0.4) {
      var ratio = m.body > 0 ? m.lowerShadow / m.body : 0;
      var confidence = Math.min(1.0, ratio / 4);  // 4倍实体 → 高置信度
      return {
        pattern: 'hammer',
        name: '锤子线',
        type: 'reversal-bull',
        index: index,
        time: candles[index].time,
        confidence: +confidence.toFixed(2),
        description: '下跌中突然出现长下影小实体，表示下方买盘涌入，可能见底反转'
      };
    }
    return null;
  }

  /**
   * 倒锤子线 (Inverted Hammer) — 小实体在下端 + 长上影 >= 2×实体，出现在下降趋势中
   */
  function detectInvertedHammer(candles, index) {
    if (index < 5) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var trend = checkTrend(candles, index, 5);
    if (trend.direction !== 'downtrend') return null;

    var bodyTop = Math.max(candles[index].open, candles[index].close);
    var bodyBottom = Math.min(candles[index].open, candles[index].close);
    var bodyCenter = (bodyTop + bodyBottom) / 2;
    var lowerThird = bodyBottom - m.upperShadow;
    // 简化：实体在下1/3区域
    if (bodyCenter > candles[index].low + m.totalRange * 0.33) return null;

    if (m.upperShadow >= m.body * 2 && m.body > 0 && (m.upperShadow / m.totalRange) >= 0.4) {
      var ratio = m.body > 0 ? m.upperShadow / m.body : 0;
      var confidence = Math.min(1.0, ratio / 3.5);
      return {
        pattern: 'inverted_hammer',
        name: '倒锤子线',
        type: 'reversal-bull',
        index: index,
        time: candles[index].time,
        confidence: +confidence.toFixed(2),
        description: '下跌中出现长上影小实体，多头试探性进攻，可能即将反转'
      };
    }
    return null;
  }

  /**
   * 流星线 (Shooting Star) — 小实体在下端 + 长上影 >= 2×实体，出现在上升趋势中
   */
  function detectShootingStar(candles, index) {
    if (index < 5) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var trend = checkTrend(candles, index, 5);
    if (trend.direction !== 'uptrend') return null;

    var bodyCenter = (Math.max(candles[index].open, candles[index].close) +
                      Math.min(candles[index].open, candles[index].close)) / 2;
    // 实体在下1/3区域
    if (bodyCenter > candles[index].low + m.totalRange * 0.33) return null;

    if (m.upperShadow >= m.body * 2 && m.body > 0 && (m.upperShadow / m.totalRange) >= 0.4) {
      var ratio = m.body > 0 ? m.upperShadow / m.body : 0;
      var confidence = Math.min(1.0, ratio / 3.5);
      return {
        pattern: 'shooting_star',
        name: '流星线',
        type: 'reversal-bear',
        index: index,
        time: candles[index].time,
        confidence: +confidence.toFixed(2),
        description: '上涨中出现长上影小实体，多头冲高受阻，卖方反扑，可能见顶反转'
      };
    }
    return null;
  }

  /**
   * 吊颈线 (Hanging Man) — 小实体在上端 + 长下影 >= 2×实体，出现在上升趋势中
   */
  function detectHangingMan(candles, index) {
    if (index < 5) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    var trend = checkTrend(candles, index, 5);
    if (trend.direction !== 'uptrend') return null;

    var bodyCenter = (Math.max(candles[index].open, candles[index].close) +
                      Math.min(candles[index].open, candles[index].close)) / 2;
    var upperThird = candles[index].high - m.totalRange * 0.33;
    if (bodyCenter < upperThird) return null;

    if (m.lowerShadow >= m.body * 2 && m.body > 0 && (m.lowerShadow / m.totalRange) >= 0.4) {
      var ratio = m.body > 0 ? m.lowerShadow / m.body : 0;
      var confidence = Math.min(1.0, ratio / 4);
      return {
        pattern: 'hanging_man',
        name: '吊颈线',
        type: 'reversal-bear',
        index: index,
        time: candles[index].time,
        confidence: +confidence.toFixed(2),
        description: '高位出现长下影小实体，表面下档有支撑，实则主力出货信号，风险加剧'
      };
    }
    return null;
  }

  /**
   * 光头光脚阳线/阴线 (Marubozu) — 实体 >= 总范围的 90%
   */
  function detectMarubozu(candles, index) {
    if (index < 0) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    if (m.bodyPct >= 0.9) {
      var confidence = Math.min(1.0, (m.bodyPct - 0.9) / 0.1);
      if (m.isBull) {
        return {
          pattern: 'marubozu_bull',
          name: '光头光脚阳线',
          type: 'bullish',
          index: index, time: candles[index].time,
          confidence: +confidence.toFixed(2),
          description: '几乎没有影线的长阳线，多头占据绝对主导，看涨力量强劲'
        };
      } else {
        return {
          pattern: 'marubozu_bear',
          name: '光头光脚阴线',
          type: 'bearish',
          index: index, time: candles[index].time,
          confidence: +confidence.toFixed(2),
          description: '几乎没有影线的长阴线，空头占据绝对主导，看跌力量强劲'
        };
      }
    }
    return null;
  }

  /**
   * 纺锤线 (Spinning Top) — 实体占 10%-30% 总范围
   */
  function detectSpinningTop(candles, index) {
    if (index < 0) return null;
    var m = candleMetrics(candles[index]);
    if (m.isFlat) return null;

    if (m.bodyPct >= 0.10 && m.bodyPct <= 0.30) {
      var confidence = 1.0 - Math.abs(m.bodyPct - 0.20) / 0.10;
      return {
        pattern: 'spinning_top',
        name: '纺锤线',
        type: 'neutral',
        index: index, time: candles[index].time,
        confidence: +Math.max(0.3, confidence).toFixed(2),
        description: '实体适中但上下影线较长，多空双方博弈激烈，方向不确定，警惕变盘'
      };
    }
    return null;
  }

  // ────── 两根K线形态 ──────

  /**
   * 看涨吞没 (Bullish Engulfing)
   * 条件：
   * 1. 第1根为阴线（空头）
   * 2. 第2根为阳线（多头），实体完全覆盖第1根实体
   * 3. 收盘2 > 开盘1（严格吞没）
   */
  function detectBullishEngulfing(candles, index) {
    if (index < 1) return null;
    var c1 = candles[index - 1], c2 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2);

    // c1必须是阴线，c2必须是阳线
    if (!m1.isBear || !m2.isBull) return null;

    var body1Top = Math.max(c1.open, c1.close);
    var body1Bot = Math.min(c1.open, c1.close);
    var body2Top = Math.max(c2.open, c2.close);
    var body2Bot = Math.min(c2.open, c2.close);

    // 实体2完全包含实体1
    if (body2Bot <= body1Bot && body2Top >= body1Top && c2.close > c1.open) {
      var engulfRatio = m2.body / Math.max(m1.body, 0.001);
      var confidence = Math.min(1.0, engulfRatio / 3);
      return {
        pattern: 'bullish_engulfing',
        name: '看涨吞没',
        type: 'bullish',
        index: index, time: c2.time,
        confidence: +confidence.toFixed(2),
        description: '阳线实体完全覆盖前一根阴线实体，多头强力反转信号'
      };
    }
    return null;
  }

  /**
   * 看跌吞没 (Bearish Engulfing)
   */
  function detectBearishEngulfing(candles, index) {
    if (index < 1) return null;
    var c1 = candles[index - 1], c2 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2);

    if (!m1.isBull || !m2.isBear) return null;

    var body1Top = Math.max(c1.open, c1.close);
    var body1Bot = Math.min(c1.open, c1.close);
    var body2Top = Math.max(c2.open, c2.close);
    var body2Bot = Math.min(c2.open, c2.close);

    if (body2Bot <= body1Bot && body2Top >= body1Top && c2.close < c1.open) {
      var engulfRatio = m2.body / Math.max(m1.body, 0.001);
      var confidence = Math.min(1.0, engulfRatio / 3);
      return {
        pattern: 'bearish_engulfing',
        name: '看跌吞没',
        type: 'bearish',
        index: index, time: c2.time,
        confidence: +confidence.toFixed(2),
        description: '阴线实体完全覆盖前一根阳线实体，空头强力反转信号'
      };
    }
    return null;
  }

  /**
   * 刺透形态 (Piercing Line)
   * 条件：
   * 1. 第1根为大阴线
   * 2. 第2根为阳线，开盘跳空低开（低于第1根最低点）
   * 3. 收盘穿越第1根实体中点以上
   */
  function detectPiercingLine(candles, index) {
    if (index < 1) return null;
    var c1 = candles[index - 1], c2 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2);

    if (!m1.isBear || !m2.isBull) return null;

    var body1Mid = (c1.open + c1.close) / 2;

    // 开2 < 低1（跳空低开），收2 > 中点1（收复一半以上）
    if (c2.open < c1.low && c2.close > body1Mid && c2.close < c1.open) {
      var penetration = (c2.close - body1Mid) / (c1.open - body1Mid + 0.001);
      var confidence = Math.min(1.0, penetration * 2);
      return {
        pattern: 'piercing_line',
        name: '刺透形态',
        type: 'bullish',
        index: index, time: c2.time,
        confidence: +confidence.toFixed(2),
        description: '跳空低开后强势回补，收盘突破前阴线中点，看涨反转信号'
      };
    }
    return null;
  }

  /**
   * 乌云盖顶 (Dark Cloud Cover)
   * 条件：
   * 1. 第1根为大阳线
   * 2. 第2根为阴线，开盘跳空高开（高于第1根最高点）
   * 3. 收盘跌破第1根实体中点以下
   */
  function detectDarkCloudCover(candles, index) {
    if (index < 1) return null;
    var c1 = candles[index - 1], c2 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2);

    if (!m1.isBull || !m2.isBear) return null;

    var body1Mid = (c1.open + c1.close) / 2;

    // 开2 > 高1（跳空高开），收2 < 中点1
    if (c2.open > c1.high && c2.close < body1Mid && c2.close > c1.open) {
      var penetration = (body1Mid - c2.close) / (body1Mid - c1.open + 0.001);
      var confidence = Math.min(1.0, penetration * 2);
      return {
        pattern: 'dark_cloud_cover',
        name: '乌云盖顶',
        type: 'bearish',
        index: index, time: c2.time,
        confidence: +confidence.toFixed(2),
        description: '跳空高开后大幅回落，收盘跌破前阳线中点，看跌反转信号'
      };
    }
    return null;
  }

  /**
   * 孕线 (Harami) — 第2根实体在第1根实体内部
   * 看涨孕线：第1根阴线 + 第2根小阳线
   * 看跌孕线：第1根阳线 + 第2根小阴线
   */
  function detectHarami(candles, index) {
    if (index < 1) return null;
    var c1 = candles[index - 1], c2 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2);

    var body1Top = Math.max(c1.open, c1.close);
    var body1Bot = Math.min(c1.open, c1.close);
    var body2Top = Math.max(c2.open, c2.close);
    var body2Bot = Math.min(c2.open, c2.close);

    // 实体2在实体1内部，且实体2明显小于实体1
    if (body2Top <= body1Top && body2Bot >= body1Bot && m2.body < m1.body * 0.7) {
      var confidence = 1 - (m2.body / Math.max(m1.body, 0.001));
      confidence = Math.min(1.0, Math.max(0.3, confidence));

      if (m1.isBear && m2.isBull) {
        return {
          pattern: 'harami_bull',
          name: '看涨孕线',
          type: 'bullish',
          index: index, time: c2.time,
          confidence: +confidence.toFixed(2),
          description: '下跌中阳线实体缩在阴线实体内，空头力量衰竭，可能反转向上'
        };
      } else if (m1.isBull && m2.isBear) {
        return {
          pattern: 'harami_bear',
          name: '看跌孕线',
          type: 'bearish',
          index: index, time: c2.time,
          confidence: +confidence.toFixed(2),
          description: '上涨中阴线实体缩在阳线实体内，多头力量衰竭，可能反转向下'
        };
      }
    }
    return null;
  }

  // ────── 三根K线形态 ──────

  /**
   * 启明星 (Morning Star)
   * 形态：大阴线 + 跳空小K线（十字/纺锤）+ 跳空大阳线（收过半）
   * 第3根为确认阳线
   */
  function detectMorningStar(candles, index) {
    if (index < 2) return null;
    var c1 = candles[index - 2], c2 = candles[index - 1], c3 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2), m3 = candleMetrics(c3);

    // 第1根：大阴线（实体占范围>50%）
    if (!m1.isBear || m1.bodyPct < 0.5) return null;
    // 第2根：小实体（实体占范围<30%），跳空低开
    if (m2.bodyPct >= 0.3) return null;
    if (Math.max(c2.open, c2.close) >= c1.close) return null; // 必须跳空在c1下方
    // 第3根：阳线，跳空高开，收过c1实体一半
    if (!m3.isBull) return null;
    if (c3.open < c2.close) return null; // 理想是跳空高开

    var body1Mid = (c1.open + c1.close) / 2;
    if (c3.close > body1Mid) {
      var confidence = 0.6;
      if (c3.close > c1.open * 0.8) confidence = 0.85;
      // 跳空越明显置信度越高
      if (c2.high < c1.close && c3.open > c2.high) confidence = 0.95;
      return {
        pattern: 'morning_star',
        name: '启明星',
        type: 'reversal-bull',
        index: index, time: c3.time,
        confidence: +Math.min(1.0, confidence).toFixed(2),
        description: '底部三根K线：大阴→星线→大阳，经典见底反转信号，后市看涨'
      };
    }
    return null;
  }

  /**
   * 黄昏星 (Evening Star)
   * 形态：大阳线 + 跳空小K线 + 跳空大阴线（收过半）
   */
  function detectEveningStar(candles, index) {
    if (index < 2) return null;
    var c1 = candles[index - 2], c2 = candles[index - 1], c3 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2), m3 = candleMetrics(c3);

    if (!m1.isBull || m1.bodyPct < 0.5) return null;
    if (m2.bodyPct >= 0.3) return null;
    if (Math.min(c2.open, c2.close) <= c1.close) return null; // 必须跳空在c1上方
    if (!m3.isBear) return null;

    var body1Mid = (c1.open + c1.close) / 2;
    if (c3.close < body1Mid) {
      var confidence = 0.6;
      if (c3.close < c1.open * 0.8) confidence = 0.85;
      if (c2.low > c1.close && c3.open < c2.low) confidence = 0.95;
      return {
        pattern: 'evening_star',
        name: '黄昏星',
        type: 'reversal-bear',
        index: index, time: c3.time,
        confidence: +Math.min(1.0, confidence).toFixed(2),
        description: '顶部三根K线：大阳→星线→大阴，经典见顶反转信号，后市看跌'
      };
    }
    return null;
  }

  /**
   * 红三兵 (Three White Soldiers)
   * 条件：连续3根阳线，每根收盘价递增，每根开盘在上一根实体中部以上
   */
  function detectThreeWhiteSoldiers(candles, index) {
    if (index < 2) return null;
    var c1 = candles[index - 2], c2 = candles[index - 1], c3 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2), m3 = candleMetrics(c3);

    if (!m1.isBull || !m2.isBull || !m3.isBull) return null;

    // 收盘价递增
    if (!(c3.close > c2.close && c2.close > c1.close)) return null;

    // 每根开盘在上一根实体中部以上
    var body1Mid = (c1.open + c1.close) / 2;
    var body2Mid = (c2.open + c2.close) / 2;

    if (c2.open >= body1Mid && c3.open >= body2Mid) {
      // 每根实体都应该比较健康（>15%波幅，排除极小微）
      if (m1.bodyPct < 0.15 || m2.bodyPct < 0.15 || m3.bodyPct < 0.15) return null;

      var avgGain = ((c3.close - c1.open) / Math.max(c1.open, 0.01));
      var confidence = Math.min(1.0, avgGain * 10);
      return {
        pattern: 'three_white_soldiers',
        name: '红三兵',
        type: 'bullish',
        index: index, time: c3.time,
        confidence: +Math.max(0.5, confidence).toFixed(2),
        description: '连续三根稳步走高的阳线，多头步步为营，上涨趋势确立'
      };
    }
    return null;
  }

  /**
   * 三只乌鸦 (Three Black Crows)
   * 条件：连续3根阴线，每根收盘价递减，每根开盘在上一根实体中部以下
   */
  function detectThreeBlackCrows(candles, index) {
    if (index < 2) return null;
    var c1 = candles[index - 2], c2 = candles[index - 1], c3 = candles[index];
    var m1 = candleMetrics(c1), m2 = candleMetrics(c2), m3 = candleMetrics(c3);

    if (!m1.isBear || !m2.isBear || !m3.isBear) return null;

    if (!(c3.close < c2.close && c2.close < c1.close)) return null;

    var body1Mid = (c1.open + c1.close) / 2;
    var body2Mid = (c2.open + c2.close) / 2;

    if (c2.open <= body1Mid && c3.open <= body2Mid) {
      if (m1.bodyPct < 0.15 || m2.bodyPct < 0.15 || m3.bodyPct < 0.15) return null;

      var avgDrop = ((c1.open - c3.close) / Math.max(c1.open, 0.01));
      var confidence = Math.min(1.0, avgDrop * 10);
      return {
        pattern: 'three_black_crows',
        name: '三只乌鸦',
        type: 'bearish',
        index: index, time: c3.time,
        confidence: +Math.max(0.5, confidence).toFixed(2),
        description: '连续三根稳步走低的阴线，空头步步为营，下跌趋势确立'
      };
    }
    return null;
  }

  // ────── 核心扫描函数 ──────

  /**
   * 扫描所有K线，检测所有支持的形态
   * @param {Array} candles - K线数组 [{time, open, high, low, close, volume}]
   * @returns {Array} 检测到的形态列表
   */
  function scan(candles) {
    try {
      if (!candles || candles.length < 2) return [];

      var results = [];
      // 所有检测函数列表
      var detectors = [
        detectDoji, detectDragonflyDoji, detectGravestoneDoji,
        detectHammer, detectInvertedHammer, detectShootingStar, detectHangingMan,
        detectMarubozu, detectSpinningTop,
        detectBullishEngulfing, detectBearishEngulfing,
        detectPiercingLine, detectDarkCloudCover,
        detectHarami,
        detectMorningStar, detectEveningStar,
        detectThreeWhiteSoldiers, detectThreeBlackCrows
      ];

      // 对每一根K线运行所有检测器
      for (var i = 0; i < candles.length; i++) {
        for (var d = 0; d < detectors.length; d++) {
          var result = detectors[d](candles, i);
          if (result) {
            results.push(result);
            // 每根K线最多返回一种形态（优先返回置信度高的）
            break;
          }
        }
      }

      // 按时间倒序排列（最新的在前）
      results.sort(function(a, b) { return b.time - a.time; });

      return results;
    } catch(e) {
      console.warn('[PatternDetector] scan error: ' + e.message);
      return [];
    }
  }

  /**
   * 获取所有支持的形态名称列表
   * @returns {Array} [{id, name, type}]
   */
  function getPatternList() {
    return PATTERN_LIST.slice();
  }

  // ────── Public API ──────
  // ────── 形态启用/禁用状态 ──────
  var enabledState = {};
  PATTERN_LIST.forEach(function(p) { enabledState[p.id] = true; });

  function getEnabledPatterns() {
    return PATTERN_LIST.filter(function(p) { return enabledState[p.id]; }).map(function(p) { return p.id; });
  }

  function setPatternEnabled(id, val) {
    if (enabledState.hasOwnProperty(id)) {
      enabledState[id] = !!val;
    }
  }

  function isPatternEnabled(id) {
    return !!enabledState[id];
  }

  /**
   * detect() — 仅检测最后3根K线的形态（每tick调用，高效）
   * 只返回已启用的形态
   */
  function detect(candles) {
    try {
      if (!candles || candles.length < 2) return [];
      var results = [];
      var detectors = [
        detectDoji, detectDragonflyDoji, detectGravestoneDoji,
        detectHammer, detectInvertedHammer, detectShootingStar, detectHangingMan,
        detectMarubozu, detectSpinningTop,
        detectBullishEngulfing, detectBearishEngulfing,
        detectPiercingLine, detectDarkCloudCover,
        detectHarami,
        detectMorningStar, detectEveningStar,
        detectThreeWhiteSoldiers, detectThreeBlackCrows
      ];
      var startIdx = Math.max(0, candles.length - 3);
      for (var i = startIdx; i < candles.length; i++) {
        for (var d = 0; d < detectors.length; d++) {
          var result = detectors[d](candles, i);
          if (result && enabledState[result.pattern]) {
            results.push(result);
            break;
          }
        }
      }
      // 缓存用于 renderMarkers
      candlesCache = candles;
      return results;
    } catch(e) { console.warn('[PatternDetector] detect error: ' + e.message); return []; }
  }

  // ────── SVG 覆盖层渲染 ──────
  var candlesCache = null;

  function initSvg(chartEl) {
    if (!chartEl) return;
    var svg = chartEl.querySelector('#patternSvg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', 'patternSvg');
      svg.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:4;pointer-events:none;');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'none');
      chartEl.appendChild(svg);
    }
    return svg;
  }

  function clearMarkers(chartEl) {
    if (!chartEl) return;
    var svg = chartEl.querySelector('#patternSvg');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function renderMarkers(patterns, chartEl, mainChart) {
    if (!chartEl || !mainChart || !patterns || patterns.length === 0) return;
    var svg = chartEl.querySelector('#patternSvg');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var rect = chartEl.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    if (w <= 0 || h <= 0) return;

    var isDark = document.documentElement.dataset.theme !== 'light';
    var bullColor = isDark ? '#ff5252' : '#e53935';
    var bearColor = isDark ? '#66bb6a' : '#2e7d32';
    var neutralColor = isDark ? '#f5a623' : '#e67e22';
    var bgStroke = isDark ? '#1a1a1a' : '#ffffff';

    function typeColor(type) {
      if (type === 'bullish' || type === 'reversal-bull') return bullColor;
      if (type === 'bearish' || type === 'reversal-bear') return bearColor;
      return neutralColor;
    }

    var emojiMap = {
      'doji': '✚', 'dragonfly_doji': '⬆', 'gravestone_doji': '⬇',
      'hammer': '🔨', 'inverted_hammer': '🔧', 'shooting_star': '⭐', 'hanging_man': '🎯',
      'marubozu_bull': '🟥', 'marubozu_bear': '🟩', 'spinning_top': '⥎',
      'bullish_engulfing': '🐂', 'bearish_engulfing': '🐻',
      'piercing_line': '↗', 'dark_cloud_cover': '☁',
      'harami_bull': '🤱', 'harami_bear': '🤰',
      'morning_star': '🌟', 'evening_star': '🌙',
      'three_white_soldiers': '⬆⬆⬆', 'three_black_crows': '⬇⬇⬇'
    };

    var timeOffsets = {};
    patterns.forEach(function(p) {
      var timeSec = Math.floor(p.time / 1000);
      var x = null;
      try { x = mainChart.timeScale().timeToCoordinate(timeSec); } catch(e) {}
      if (x === null || x === undefined || x < 0 || x > w) return;

      var isBullType = p.type === 'bullish' || p.type === 'reversal-bull';
      var candle = (candlesCache && candlesCache.length > p.index) ? candlesCache[p.index] : null;
      var markerPrice;
      if (isBullType) {
        markerPrice = (candle ? candle.high : 100) * 1.012;
      } else {
        markerPrice = (candle ? candle.low : 100) * 0.988;
      }

      var y = null;
      try { y = mainChart.priceScale('right').priceToCoordinate(markerPrice); } catch(e) {}
      if (y === null || y === undefined) return;

      var tKey = String(timeSec);
      if (timeOffsets[tKey] !== undefined) {
        var off = isBullType ? -18 : 18;
        y = y + timeOffsets[tKey] * off;
        timeOffsets[tKey]++;
      } else {
        timeOffsets[tKey] = 1;
      }

      var emoji = emojiMap[p.pattern] || '●';
      var color = typeColor(p.type);

      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x); text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '13');
      text.setAttribute('fill', color);
      text.setAttribute('style', 'pointer-events:none; paint-order:stroke; stroke:' + bgStroke + '; stroke-width:2px;');
      text.textContent = emoji;
      svg.appendChild(text);

      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', isBullType ? y - 16 : y + 14);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '8');
      label.setAttribute('font-family', 'Microsoft YaHei, sans-serif');
      label.setAttribute('fill', isDark ? '#999' : '#666');
      label.setAttribute('style', 'pointer-events:none;');
      label.textContent = p.name;
      svg.appendChild(label);
    });
  }

  return {
    scan: scan,
    detect: detect,
    getPatternList: getPatternList,
    getEnabledPatterns: getEnabledPatterns,
    setPatternEnabled: setPatternEnabled,
    isPatternEnabled: isPatternEnabled,
    initSvg: initSvg,
    clearMarkers: clearMarkers,
    renderMarkers: renderMarkers
  };

})();
