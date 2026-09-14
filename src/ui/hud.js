import { PALETTE } from '../render/palette.js';

/**
 * The HUD.
 *
 * Arcade HUDs are loud, chunky and readable from two metres away across a
 * noisy room, because that is the environment they were designed for. Every
 * choice here follows from that: heavy condensed type, hard drop shadows
 * instead of soft ones, no thin strokes, no subtle greys, and state changes
 * that announce themselves with a snap rather than a fade.
 *
 * The crosshair is the exception to "HUD is DOM": it still lives here, but it
 * is positioned every frame from the smoothed aim signal, and it changes shape
 * rather than colour when the player cannot shoot — colour alone is not enough
 * when the whole game is lit amber.
 */
export class Hud {
  constructor(root, bus) {
    this.root = root;
    this.bus = bus;
    this.el = {};
    this.#build();
    this.#wire();
    this.bannerTtl = 0;
    this.hitTtl = 0;
    this.popups = [];
  }

  #build() {
    this.root.innerHTML = `
      <div id="hud">
        <div class="hud-top">
          <div class="panel score-panel">
            <div class="label">SCORE</div>
            <div class="value" id="score">0</div>
          </div>

          <div class="timer-wrap">
            <div class="label" id="area-name">—</div>
            <div class="timer" id="timer">00</div>
          </div>

          <div class="panel lives-panel">
            <div class="label">LIVES</div>
            <div class="lives" id="lives"></div>
          </div>
        </div>

        <div class="combo" id="combo"></div>

        <div class="hud-bottom">
          <div class="cover-state" id="cover-state">
            <div class="cover-bar"><div class="cover-fill" id="cover-fill"></div></div>
            <div class="cover-label" id="cover-label">IN COVER</div>
          </div>
          <div class="ammo-wrap">
            <div class="weapon-name" id="weapon">HANDGUN</div>
            <div class="ammo" id="ammo"></div>
            <div class="reload-bar"><div class="reload-fill" id="reload-fill"></div></div>
          </div>
        </div>

        <div class="crosshair" id="crosshair">
          <svg viewBox="0 0 64 64">
            <!-- Dark outline pass first, light strokes over it. Drawing the
                 outline as its own set of shapes rather than as a filter keeps
                 it crisp at every scale. -->
            <g class="ch-outline">
              <circle cx="32" cy="32" r="19"/>
              <line x1="32" y1="3"  x2="32" y2="17"/>
              <line x1="32" y1="47" x2="32" y2="61"/>
              <line x1="3"  y1="32" x2="17" y2="32"/>
              <line x1="47" y1="32" x2="61" y2="32"/>
            </g>
            <circle cx="32" cy="32" r="19" class="ch-ring"/>
            <line x1="32" y1="3"  x2="32" y2="17" class="ch-tick"/>
            <line x1="32" y1="47" x2="32" y2="61" class="ch-tick"/>
            <line x1="3"  y1="32" x2="17" y2="32" class="ch-tick"/>
            <line x1="47" y1="32" x2="61" y2="32" class="ch-tick"/>
            <circle cx="32" cy="32" r="2.6" class="ch-dot"/>
          </svg>
        </div>

        <div class="banner" id="banner"></div>
        <div class="popups" id="popups"></div>
        <div class="hit-flash" id="hit-flash"></div>

        <div class="boss-bar" id="boss-bar">
          <div class="boss-name" id="boss-name">LE CORBEAU</div>
          <div class="boss-track"><div class="boss-fill" id="boss-fill"></div></div>
        </div>

        <div class="overlay" id="overlay">
          <div class="overlay-card" id="overlay-card"></div>
        </div>

        <div class="gesture-hint" id="gesture-hint">
          <div class="gh-row"><b>POINT</b><span>index finger aims</span></div>
          <div class="gh-row"><b>CURL</b><span>middle finger fires</span></div>
          <div class="gh-row"><b>GUN UP</b><span>duck &amp; reload</span></div>
        </div>
      </div>`;

    for (const id of ['score', 'timer', 'lives', 'combo', 'ammo', 'weapon',
      'crosshair', 'banner', 'area-name', 'cover-fill', 'cover-label',
      'reload-fill', 'hit-flash', 'popups', 'cover-state', 'gesture-hint',
      'boss-bar', 'boss-name', 'boss-fill', 'overlay', 'overlay-card']) {
      this.el[id] = this.root.querySelector(`#${id}`);
    }
  }

  #wire() {
    this.bus.on('area.started', ({ name, index }) => {
      this.el['area-name'].textContent = `AREA ${index + 1} — ${name.toUpperCase()}`;
      this.showBanner('ACTION!', 'action');
    });
    this.bus.on('area.cleared', ({ bonus, noHit }) => {
      this.showBanner(noHit ? 'AREA CLEAR!  NO HIT!' : 'AREA CLEAR!', 'clear');
      this.popup(`+${bonus.toLocaleString()}`, 'bonus');
      if (noHit) this.popup('+5,000 NO HIT', 'bonus');
    });
    this.bus.on('area.timeout', () => this.showBanner('TIME UP', 'fail'));
    this.bus.on('weapon.empty', () => this.showBanner('RELOAD!', 'reload'));
    this.bus.on('game.over', () => this.showBanner('GAME OVER', 'fail', 9));
    this.bus.on('stage.complete', () => this.showBanner('STAGE CLEAR!', 'clear', 9));
    this.bus.on('player.hit', () => { this.hitTtl = 0.5; });
    this.bus.on('weapon.granted', ({ weapon }) => {
      this.showBanner(weapon.replace('_', ' '), 'pickup', 1.3);
      this.popup(`${weapon.replace('_', ' ')} ACQUIRED`, 'bonus');
    });
    this.bus.on('weapon.expired', () => this.popup('HANDGUN', 'kill'));

    this.bus.on('player.died', ({ livesLeft }) => {
      this.showBanner(livesLeft === 1 ? 'LAST LIFE' : 'LIFE LOST', 'fail', 1.4);
    });
    this.bus.on('area.retry', () => this.showBanner('RETRY', 'action', 1.2));

    this.bus.on('area.cleared', (p) => this.#showResults(p));
    this.bus.on('game.over', (p) => this.#showGameOver(p));
    this.bus.on('continue.tick', ({ secondsLeft }) => this.#tickContinue(secondsLeft));
    this.bus.on('game.continued', () => this.#hideOverlay());
    this.bus.on('stage.complete', () => this.#showStageClear());

    this.bus.on('enemy.killed', ({ score, part, multiplier }) => {
      this.popup(`${part === 'head' ? 'HEAD ' : ''}+${score.toLocaleString()}${multiplier > 1 ? ` x${multiplier}` : ''}`,
        part === 'head' ? 'head' : 'kill');
    });
  }

  // -------------------------------------------------------------------------
  // Overlays
  //
  // Arcade results screens COUNT. The number climbing is the reward, not the
  // final figure — a total that simply appears is a fact, and a total that
  // ticks up is a small ceremony. Every panel here animates its numbers for
  // that reason, and the tick has a sound behind it.
  // -------------------------------------------------------------------------

  #showOverlay(html, kind = '') {
    this.el['overlay-card'].innerHTML = html;
    this.el.overlay.className = `overlay show ${kind}`;
  }

  #hideOverlay() {
    this.el.overlay.className = 'overlay';
  }

  /** Count a number up over `ms`, calling back each step. */
  #countUp(el, to, ms = 900, prefix = '') {
    if (!el) return;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease out, so it slams toward the total and settles rather than
      // crawling linearly.
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + Math.round(to * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
      else this.bus.emit('ui.countFinished', {});
    };
    requestAnimationFrame(tick);
  }

  #showResults({ name, timeLeft, noHit, bonus }) {
    const timeBonus = Math.floor(timeLeft ?? 0) * 100;
    this.#showOverlay(`
      <h3>AREA CLEAR</h3>
      <div class="sub">${(name ?? '').toUpperCase()}</div>
      <dl>
        <div><dt>TIME REMAINING</dt><dd>${Math.floor(timeLeft ?? 0)}s</dd></div>
        <div><dt>TIME BONUS</dt><dd id="r-time">0</dd></div>
        ${noHit ? '<div class="hl"><dt>NO HIT BONUS</dt><dd id="r-nohit">0</dd></div>' : ''}
        <div class="total"><dt>AREA TOTAL</dt><dd id="r-total">0</dd></div>
      </dl>`, 'results');
    const card = this.el['overlay-card'];
    this.#countUp(card.querySelector('#r-time'), timeBonus, 600);
    if (noHit) this.#countUp(card.querySelector('#r-nohit'), 5000, 800);
    this.#countUp(card.querySelector('#r-total'), (bonus ?? 0) + (noHit ? 5000 : 0), 1100);
    setTimeout(() => this.#hideOverlay(), 2000);
  }

  #showGameOver({ score, bestCombo, accuracy, rank, continueSeconds }) {
    this.#showOverlay(`
      <h3 class="danger">GAME OVER</h3>
      <dl>
        <div><dt>SCORE</dt><dd>${(score ?? 0).toLocaleString()}</dd></div>
        <div><dt>BEST COMBO</dt><dd>${bestCombo ?? 0}</dd></div>
        <div><dt>ACCURACY</dt><dd>${Math.round((accuracy ?? 0) * 100)}%</dd></div>
        <div class="total"><dt>RANK</dt><dd class="rank">${rank ?? '-'}</dd></div>
      </dl>
      <div class="continue">
        <div class="continue-label">CONTINUE?</div>
        <div class="continue-count" id="cont-count">${continueSeconds ?? 10}</div>
        <div class="continue-hint">raise the gun to continue</div>
      </div>`, 'gameover');
  }

  #tickContinue(secondsLeft) {
    const el = this.el['overlay-card'].querySelector('#cont-count');
    if (!el) return;
    el.textContent = String(secondsLeft);
    // Re-trigger the slam animation on every tick so the countdown pulses.
    el.classList.remove('slam');
    void el.offsetWidth;
    el.classList.add('slam');
    el.classList.toggle('critical', secondsLeft <= 3);
  }

  #showStageClear() {
    const s = this.lastSnapshot ?? {};
    this.#showOverlay(`
      <h3 class="win">STAGE CLEAR</h3>
      <div class="sub">MONTMARTRE &mdash; LAMARCK TO ABBESSES</div>
      <dl>
        <div><dt>FINAL SCORE</dt><dd id="sc-score">0</dd></div>
        <div><dt>BEST COMBO</dt><dd>${s.bestCombo ?? 0}</dd></div>
        <div><dt>ACCURACY</dt><dd>${Math.round((s.accuracy ?? 0) * 100)}%</dd></div>
        <div><dt>NO-HIT AREAS</dt><dd>${s.areasNoHit ?? 0} / 5</dd></div>
        <div><dt>CREDITS USED</dt><dd>${s.continuesUsed ?? 0}</dd></div>
        <div class="total"><dt>RANK</dt><dd class="rank">${s.rank ?? '-'}</dd></div>
      </dl>`, 'stageclear');
    this.#countUp(this.el['overlay-card'].querySelector('#sc-score'), s.score ?? 0, 1600);
  }

  showBanner(text, kind = 'action', seconds = 1.6) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = `banner show ${kind}`;
    this.bannerTtl = seconds;
  }

  popup(text, kind) {
    const d = document.createElement('div');
    d.className = `popup ${kind}`;
    d.textContent = text;
    // Scatter a little so a burst of kills does not stack into an unreadable pile.
    d.style.left = `${46 + (Math.random() - 0.5) * 22}%`;
    d.style.top = `${42 + (Math.random() - 0.5) * 16}%`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  /**
   * @param {ReturnType<import('../gameplay/game.js').Game['snapshot']>} s
   * @param {{x:number,y:number}} aim normalised
   * @param {number} dt
   */
  update(s, aim, dt) {
    // Kept so the stage-clear panel can report the whole run; that event
    // carries no payload of its own.
    this.lastSnapshot = s;

    this.el.score.textContent = s.score.toLocaleString();

    // Boss health. Only visible while there is a boss, because a permanent
    // empty bar trains the player to ignore that part of the screen.
    if (s.boss) {
      this.el['boss-bar'].classList.add('show');
      this.el['boss-name'].textContent = s.boss.name;
      const frac = Math.max(0, s.boss.hp / s.boss.maxHp);
      this.el['boss-fill'].style.width = `${frac * 100}%`;
      this.el['boss-fill'].classList.toggle('low', frac <= 0.34);
    } else {
      this.el['boss-bar'].classList.remove('show');
    }

    const t = Math.ceil(s.timeLeft);
    this.el.timer.textContent = String(Math.max(0, t)).padStart(2, '0');
    this.el.timer.classList.toggle('critical', t <= 10 && s.directorState === 'FIGHTING');

    // Lives as pips rather than a number — instant to read, no parsing.
    if (this.el.lives.childElementCount !== 3) {
      this.el.lives.innerHTML = '<i></i><i></i><i></i>';
    }
    [...this.el.lives.children].forEach((pip, i) => {
      pip.classList.toggle('lost', i >= s.lives);
    });

    // Ammo as discrete rounds, so the player counts shapes not digits. Above a
    // dozen rounds that stops being readable, so the big magazines get a number.
    if (s.magSize <= 12) {
      if (this.el.ammo.childElementCount !== s.magSize || this.el.ammo.dataset.mag !== String(s.magSize)) {
        this.el.ammo.dataset.mag = String(s.magSize);
        this.el.ammo.innerHTML = '<i></i>'.repeat(s.magSize);
        this.el.ammo.classList.remove('numeric');
      }
      [...this.el.ammo.children].forEach((r, i) => r.classList.toggle('spent', i >= s.rounds));
    } else {
      this.el.ammo.classList.add('numeric');
      this.el.ammo.textContent = `${s.rounds} / ${s.magSize}`;
    }
    this.el.ammo.classList.toggle('empty', s.rounds === 0);
    this.el.weapon.textContent = s.weapon;

    // Cover. The bar IS the exposure scalar, so the player can see the
    // transition they are paying for.
    this.el['cover-fill'].style.width = `${s.exposure * 100}%`;
    const label = { COVERED: 'IN COVER', EMERGING: 'COMING OUT', EXPOSED: 'EXPOSED', HIDING: 'GETTING DOWN' }[s.coverState];
    this.el['cover-label'].textContent = label;
    this.el['cover-state'].className = `cover-state ${s.coverState.toLowerCase()}`;

    this.el['reload-fill'].style.width = s.reloading ? `${s.reloadProgress * 100}%` : '0%';

    // Combo.
    if (s.combo >= 2) {
      this.el.combo.textContent = `${s.combo} HIT${s.multiplier > 1 ? `  ×${s.multiplier}` : ''}`;
      this.el.combo.classList.add('show');
    } else {
      this.el.combo.classList.remove('show');
    }

    // Crosshair. Shape carries the state, not just colour.
    const ch = this.el.crosshair;
    ch.style.left = `${aim.x * 100}%`;
    ch.style.top = `${aim.y * 100}%`;
    ch.classList.toggle('covered', s.coverState !== 'EXPOSED');
    ch.classList.toggle('empty', s.rounds === 0);

    if (this.bannerTtl > 0) {
      this.bannerTtl -= dt;
      if (this.bannerTtl <= 0) this.el.banner.className = 'banner';
    }
    if (this.hitTtl > 0) {
      this.hitTtl -= dt;
      this.el['hit-flash'].style.opacity = String(Math.max(0, this.hitTtl * 1.6));
    }
  }

  hideHints() { this.el['gesture-hint'].classList.add('faded'); }
}

void PALETTE;
