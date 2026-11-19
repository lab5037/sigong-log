/*!
 * 현장로그 캔버스 — 비포·애프터 비교 카드(1080x1080) 합성 + 예시 사진 생성
 */
(function (root) {
  'use strict';

  const SIZE = 1080;
  const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('이미지를 불러오지 못했습니다.')); };
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // 사진을 영역에 꽉 차게(cover) 그린다.
  function drawCover(ctx, img, x, y, w, h) {
    const ir = img.width / img.height;
    const rr = w / h;
    let sw, sh, sx, sy;
    if (ir > rr) { sh = img.height; sw = sh * rr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / rr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function drawBadge(ctx, text, x, y, accent) {
    ctx.save();
    ctx.font = '700 30px ' + FONT;
    const padX = 24, h = 56;
    const w = ctx.measureText(text).width + padX * 2;
    ctx.fillStyle = accent ? '#f5620f' : 'rgba(15,27,42,0.82)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + padX, y + h / 2 + 1);
    ctx.restore();
  }

  function drawBanner(ctx, opts) {
    const h = 300;
    const y0 = SIZE - h;
    const g = ctx.createLinearGradient(0, y0, 0, SIZE);
    g.addColorStop(0, 'rgba(9,16,26,0)');
    g.addColorStop(0.45, 'rgba(9,16,26,0.62)');
    g.addColorStop(1, 'rgba(9,16,26,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, SIZE, h);

    const place = (opts.place || '').trim() || '현장';
    const sub = [opts.industryLabel, opts.businessName].filter(Boolean).join(' · ');

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 업종 칩
    if (opts.industryLabel) {
      ctx.font = '600 26px ' + FONT;
      const tw = ctx.measureText(opts.industryLabel).width;
      ctx.fillStyle = 'rgba(245,98,15,0.92)';
      roundRect(ctx, 56, 872, tw + 40, 48, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(opts.industryLabel, 76, 905);
    }

    // 지역·건물
    let placeSize = 54;
    ctx.font = '800 ' + placeSize + 'px ' + FONT;
    while (ctx.measureText(place).width > SIZE - 112 && placeSize > 30) {
      placeSize -= 2;
      ctx.font = '800 ' + placeSize + 'px ' + FONT;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(place, 56, 975);

    if (sub) {
      ctx.font = '500 30px ' + FONT;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillText(sub, 56, 1028);
    }
    ctx.restore();
  }

  /**
   * 비포·애프터 비교 카드 생성
   * @param {object} o {before:dataURL, after:dataURL, during:dataURL, layout:'h'|'v', place, industryLabel, businessName}
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function compose(o) {
    o = o || {};
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f1b2a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const hasBefore = !!o.before;
    const hasAfter = !!o.after;
    const layout = o.layout === 'v' ? 'v' : 'h';

    if (!hasBefore && !hasAfter) {
      // 사진이 없으면 안내 카드
      ctx.fillStyle = '#1b2b3f';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 40px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('시공 전·후 사진을 올리면', SIZE / 2, SIZE / 2 - 20);
      ctx.fillText('비교 카드가 자동으로 만들어집니다', SIZE / 2, SIZE / 2 + 40);
      drawBanner(ctx, o);
      return canvas;
    }

    const gap = 10;

    if (hasBefore && hasAfter) {
      const beforeImg = await loadImage(o.before);
      const afterImg = await loadImage(o.after);

      if (layout === 'h') {
        const half = (SIZE - gap) / 2;
        drawCover(ctx, beforeImg, 0, 0, half, SIZE);
        drawCover(ctx, afterImg, half + gap, 0, half, SIZE);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(half, 0, gap, SIZE);
        drawBadge(ctx, 'BEFORE', 28, 28, false);
        drawBadge(ctx, 'AFTER', half + gap + 28, 28, true);
      } else {
        const half = (SIZE - gap) / 2;
        drawCover(ctx, beforeImg, 0, 0, SIZE, half);
        drawCover(ctx, afterImg, 0, half + gap, SIZE, half);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, half, SIZE, gap);
        drawBadge(ctx, 'BEFORE', 28, 28, false);
        drawBadge(ctx, 'AFTER', 28, half + gap + 28, true);
      }
      drawBanner(ctx, o);
    } else {
      const src = hasAfter ? o.after : o.before;
      const img = await loadImage(src);
      drawCover(ctx, img, 0, 0, SIZE, SIZE);
      drawBadge(ctx, hasAfter ? 'AFTER' : 'BEFORE', 28, 28, hasAfter);
      drawBanner(ctx, o);
    }

    // 얇은 프레임
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);

    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, type || 'image/png', quality || 0.95);
    });
  }

  /* ─────────────────── 예시 사진 (타일 벽 일러스트) ─────────────────── */

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawTileScene(mode) {
    const W = 1200, H = 900;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const rand = rng(20261119);
    const dirty = mode !== 'after';

    // 벽 배경
    const bg = x.createLinearGradient(0, 0, W, H);
    if (dirty) { bg.addColorStop(0, '#8e857a'); bg.addColorStop(0.5, '#7b7267'); bg.addColorStop(1, '#5f574e'); }
    else { bg.addColorStop(0, '#f4f1ea'); bg.addColorStop(0.55, '#e9e4da'); bg.addColorStop(1, '#d6cec1'); }
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);

    // 타일
    const tileW = 150, tileH = 140, grout = 8;
    for (let row = 0; row * tileH < H; row++) {
      for (let col = 0; col * tileW < W + tileW; col++) {
        const tx = col * tileW + grout / 2;
        const ty = row * tileH + grout / 2;
        const tw = tileW - grout;
        const th = tileH - grout;
        const tidy = mode === 'during' && (col + row) % 3 === 0;

        let base;
        if (!dirty || tidy) {
          const l = 232 + Math.floor(rand() * 18);
          base = 'rgb(' + l + ',' + (l - 4) + ',' + (l - 12) + ')';
        } else {
          const l = 148 + Math.floor(rand() * 40);
          base = 'rgb(' + l + ',' + (l - 8) + ',' + (l - 20) + ')';
        }
        const tg = x.createLinearGradient(tx, ty, tx + tw, ty + th);
        tg.addColorStop(0, base);
        tg.addColorStop(1, dirty && !tidy ? 'rgba(90,80,68,0.55)' : 'rgba(255,255,255,0.35)');
        x.fillStyle = tg;
        x.fillRect(tx, ty, tw, th);

        // 유리 질감 하이라이트
        x.fillStyle = dirty && !tidy ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)';
        x.fillRect(tx + tw * 0.1, ty + th * 0.12, tw * 0.34, th * 0.1);

        // 줄눈
        x.fillStyle = dirty && !tidy ? '#5c5348' : '#d8d1c4';
        x.fillRect(tx + tw, ty, grout, th + grout);
        x.fillRect(tx, ty + th, tw, grout);
      }
    }

    if (dirty) {
      // 곰팡이 얼룩
      for (let i = 0; i < 90; i++) {
        const sx = rand() * W, sy = rand() * H;
        const r = 3 + rand() * 22;
        const g2 = x.createRadialGradient(sx, sy, 0, sx, sy, r);
        const dark = rand() > 0.4;
        g2.addColorStop(0, dark ? 'rgba(40,34,26,0.55)' : 'rgba(96,86,52,0.35)');
        g2.addColorStop(1, 'rgba(40,34,26,0)');
        x.fillStyle = g2;
        x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill();
      }
      // 물때 흘러내린 자국
      for (let i = 0; i < 14; i++) {
        const sx = rand() * W, sy = rand() * H * 0.6;
        const w = 6 + rand() * 16, h = 120 + rand() * 260;
        const g3 = x.createLinearGradient(sx, sy, sx, sy + h);
        g3.addColorStop(0, 'rgba(255,255,255,0.10)');
        g3.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g3;
        x.fillRect(sx, sy, w, h);
      }
    } else {
      // 청소 후 광택
      for (let i = 0; i < 26; i++) {
        const sx = rand() * W, sy = rand() * H;
        x.fillStyle = 'rgba(255,255,255,' + (0.25 + rand() * 0.45) + ')';
        x.beginPath(); x.arc(sx, sy, 2 + rand() * 4, 0, Math.PI * 2); x.fill();
      }
    }

    if (mode === 'during') {
      // 걸레와 작업 흔적
      x.save();
      x.fillStyle = 'rgba(255,255,255,0.16)';
      x.fillRect(W * 0.1, H * 0.45, W * 0.8, H * 0.14);
      x.restore();
      const cx = W * 0.62, cy = H * 0.72;
      x.fillStyle = '#e6b53f';
      roundRect(x, cx, cy, 250, 170, 26);
      x.fill();
      x.fillStyle = '#c99a2b';
      roundRect(x, cx + 20, cy + 26, 210, 34, 12);
      x.fill();
    }

    // 비네팅
    const vg = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);

    return c;
  }

  function makeSamplePhotos() {
    return {
      before: drawTileScene('before').toDataURL('image/jpeg', 0.9),
      during: drawTileScene('during').toDataURL('image/jpeg', 0.9),
      after: drawTileScene('after').toDataURL('image/jpeg', 0.9)
    };
  }

  root.FieldLogCanvas = {
    SIZE: SIZE,
    compose: compose,
    canvasToBlob: canvasToBlob,
    makeSamplePhotos: makeSamplePhotos
  };
})(window);
