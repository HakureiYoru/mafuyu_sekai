import Script from 'next/script';

export default function HomePage() {
  return (
    <main>
      <canvas id="gameCanvas"></canvas>

      <div id="ui-layer">
        <div className="hud-top">
          <div className="score-box" id="score-display">
            000000
          </div>
          <div className="bomb-box">
            <span style={{ fontSize: '14px', color: '#888', letterSpacing: '1px' }}>
              NUCLEAR PROTOCOL
            </span>
            <span id="bomb-display">BOMB x3</span>
            <div style={{ fontSize: '12px', color: '#666' }}>[SPACE]</div>
          </div>
        </div>

        <div id="wave-text">
          WAVE 1
          <span id="wave-sub">SYSTEM ONLINE</span>
        </div>

        <div className="hud-bottom">
          <div className="stats-group">
            <div className="bar-wrapper">
              <div className="label">HULL INTEGRITY</div>
              <div className="bar-container">
                <div id="hp-bar" className="bar-fill hp-fill"></div>
              </div>
            </div>
            <div className="bar-wrapper">
              <div className="label">
                WEAPON CHARGE (LVL <span id="lvl-display">1</span>)
              </div>
              <div className="bar-container">
                <div id="xp-bar" className="bar-fill xp-fill" style={{ width: '0%' }}></div>
              </div>
            </div>
            <div className="bar-wrapper">
              <div className="label">
                AMMO CORE <span id="ammo-text" className="hud-pill">300/300</span>
              </div>
              <div className="bar-container">
                <div id="ammo-bar" className="bar-fill ammo-fill" style={{ width: '100%' }}></div>
              </div>
            </div>
            <div className="bar-wrapper">
              <div className="label">
                DASH LASER <span id="special-text" className="hud-pill">LOCKED</span>
              </div>
              <div className="bar-container" id="special-bar-container">
                <div id="special-bar" className="bar-fill special-fill" style={{ width: '0%' }}></div>
              </div>
            </div>
            <div className="bar-wrapper">
              <div className="label">
                THERMAL LOAD <span id="heat-text" className="hud-pill">0%</span>{' '}
                <span id="heat-status" className="hud-pill status-pill">STABLE</span>
              </div>
              <div className="bar-container">
                <div id="heat-bar" className="bar-fill heat-fill" style={{ width: '0%' }}></div>
              </div>
            </div>
          </div>

          <div id="comms-panel">
            <div className="comms-avatar-wrap">
              <img id="comms-avatar" src="/assets/images/enemy.png" alt="Speaker" />
            </div>
            <div className="comms-body">
              <div id="comms-sender">SYSTEM</div>
              <div id="comms-text">...</div>
            </div>
          </div>
        </div>
      </div>

      <div id="start-screen">
        <h1>MAFUYU SEKAI</h1>
        <h2>NEON OVERDRIVE v2.5</h2>
        <button id="start-btn">ENGAGE</button>
        <div className="controls">
          <div className="key-row">
            <span className="kbox">W</span>
            <span className="kbox">A</span>
            <span className="kbox">S</span>
            <span className="kbox">D</span> <span>移动 (Move)</span>
          </div>
          <div className="key-row">
            <span className="kbox">MOUSE</span> <span>瞄准和射击 (Aim &amp; Shoot)</span>
          </div>
          <div className="key-row">
            <span className="kbox">R</span> / <span className="kbox">R-CLICK</span>{' '}
            <span>战术冲刺 (Dash)</span>
          </div>
          <div className="key-row">
            <span className="kbox highlight">SPACE</span> <span>清屏核弹 (Nuke)</span>
          </div>
        </div>
      </div>

      <div id="game-over-screen" style={{ display: 'none' }}>
        <h1 style={{ fontSize: '60px', color: '#ff3333', WebkitTextFillColor: '#ff3333' }}>
          CRITICAL FAILURE
        </h1>
        <div id="final-score" style={{ fontSize: '30px', marginBottom: '20px', color: '#fff' }}>
          SCORE: 0
        </div>
        <div
          id="ai-analysis"
          style={{
            color: '#00ccff',
            marginBottom: '30px',
            fontFamily: 'monospace',
            maxWidth: '600px',
            textAlign: 'center',
            minHeight: '20px',
          }}
        ></div>
        <button id="restart-btn">REBOOT SYSTEM</button>
      </div>

      <div
        id="mission-complete-screen"
        style={{
          display: 'none',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,0.9)',
          zIndex: 200,
        }}
      >
        <h1
          style={{
            fontSize: '60px',
            color: '#00ff00',
            WebkitTextFillColor: '#00ff00',
            textShadow: '0 0 20px #00ff00',
          }}
        >
          MISSION COMPLETE
        </h1>
        <div style={{ fontSize: '24px', color: '#fff', marginBottom: '40px', textAlign: 'center', maxWidth: '600px' }}>
          <p>Target &quot;MAFUYU&quot; stabilized.</p>
          <p>System integrity restored.</p>
        </div>
        <div style={{ display: 'flex', gap: '20px' }}>
          <button
            id="btn-restart-complete"
            style={{ background: 'transparent', border: '2px solid #fff', color: '#fff' }}
          >
            RESTART
          </button>
          <button
            id="btn-continue"
            style={{
              background: '#00ff00',
              border: '2px solid #00ff00',
              color: '#000',
              fontWeight: 'bold',
              boxShadow: '0 0 15px #00ff00',
            }}
          >
            CONTINUE (ENDLESS)
          </button>
        </div>
      </div>

      <Script src="/js/main.js" strategy="afterInteractive" />
    </main>
  );
}
