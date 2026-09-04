<template>
  <figure class="signett-overview">
    <div class="signett-overview-grid">
      <section class="overview-clients" aria-labelledby="overview-clients-title">
        <div
          id="overview-clients-title"
          class="overview-section-title"
          role="heading"
          aria-level="2"
        >
          Three ways in
        </div>

        <article class="overview-client">
          <span class="overview-dot call"></span>
          <div>
            <div class="overview-client-title" role="heading" aria-level="3">
              Browser agent
            </div>
            <p>Any WebMCP-capable agent</p>
          </div>
        </article>

        <article class="overview-client featured">
          <span class="overview-dot call"></span>
          <div>
            <div class="overview-client-title" role="heading" aria-level="3">
              Signett Explorer
            </div>
            <p>Chrome Agent + page Inspector</p>
          </div>
        </article>

        <article class="overview-client">
          <span class="overview-dot call"></span>
          <div>
            <div class="overview-client-title" role="heading" aria-level="3">
              Signett Headless Eval
            </div>
            <p>Driven by Codex or another harness</p>
            <small>benchmarks · evidence · checks</small>
          </div>
        </article>
      </section>

      <div class="overview-connector inbound" aria-hidden="true">
        <span>invoke</span>
        <i></i>
      </div>

      <section class="overview-core" aria-labelledby="overview-core-title">
        <header>
          <div
            id="overview-core-title"
            class="overview-core-title"
            role="heading"
            aria-level="2"
          >
            <span></span>Signett core
          </div>
          <p>Native WebMCP</p>
        </header>

        <div class="overview-core-body">
          <div class="overview-tools-heading">
            <strong>N WebMCP tools</strong>
            <span>Each composes only what it needs</span>
          </div>

          <article class="overview-tool read">
            <div class="overview-tool-name">
              <strong>Read</strong>
              <code>search_*</code>
            </div>
            <div class="overview-pipeline">
              <span class="stage validate">validate</span>
              <i>→</i>
              <span class="stage execute">execute</span>
              <i>→</i>
              <span class="stage">output budget</span>
            </div>
          </article>

          <article class="overview-tool private-read">
            <div class="overview-tool-name">
              <strong>Private read</strong>
              <code>get_*</code>
            </div>
            <div class="overview-pipeline">
              <span class="stage validate">validate</span>
              <i>→</i>
              <span class="stage">context</span>
              <i>→</i>
              <span class="stage">authorize</span>
              <i>→</i>
              <span class="stage execute">execute</span>
              <i>→</i>
              <span class="stage verify">verify</span>
            </div>
          </article>

          <article class="overview-tool effect">
            <div class="overview-tool-name">
              <strong>Effect</strong>
              <code>act_*</code>
              <small>no blind retry</small>
            </div>
            <div class="overview-effect-pipelines">
              <div class="overview-pipeline">
                <span class="stage validate">validate</span>
                <i>→</i>
                <span class="stage">context</span>
                <i>→</i>
                <span class="stage">authorize</span>
                <i>→</i>
                <span class="stage">confirm</span>
              </div>
              <div class="overview-pipeline">
                <span class="stage reliable">idempotency + journal</span>
                <i>→</i>
                <span class="stage execute">execute</span>
                <i>→</i>
                <span class="stage">recover</span>
                <i>→</i>
                <span class="stage verify">verify</span>
              </div>
            </div>
          </article>

          <div class="overview-activity">
            <strong>Activity</strong>
            <span>running · confirmation · verifying · succeeded / unknown</span>
          </div>

          <div class="overview-telemetry">
            <strong>Telemetry</strong>
            <span>registration → call → replay / recovery → proof</span>
            <small>privacy-safe by default</small>
          </div>
        </div>
      </section>

      <div class="overview-connector outbound" aria-hidden="true">
        <div class="effect-wire"><span>execute</span><i></i></div>
        <div class="status-wire"><span>status</span><i></i></div>
      </div>

      <section class="overview-site" aria-labelledby="overview-site-title">
        <header>
          <div
            id="overview-site-title"
            class="overview-site-title"
            role="heading"
            aria-level="2"
          >
            Your website
          </div>
          <p>Owns the outcome.</p>
        </header>

        <div class="overview-site-card">
          <strong>Application</strong>
          <span>Functions · identity · data</span>
        </div>

        <div class="overview-site-card ui">
          <strong>Site UI</strong>
          <span>React to activity</span>
        </div>

        <small>The site owns the DOM change</small>
      </section>
    </div>

    <figcaption>
      Three clients use one native WebMCP surface. Each tool selects its own execution
      controls; Signett exposes activity and telemetry while the website owns its
      business state and UI.
    </figcaption>
  </figure>
</template>

<style scoped>
.signett-overview {
  container-type: inline-size;
  margin: 32px 0 40px;
  color: var(--sg-ink);
}

.signett-overview-grid {
  display: grid;
  grid-template-columns:
    minmax(172px, 0.85fr) 44px minmax(500px, 2.5fr) 58px
    minmax(176px, 0.88fr);
  align-items: center;
  width: 100%;
}

.overview-section-title,
.overview-core-title,
.overview-site-title,
.overview-client-title,
.overview-client p,
.overview-core p,
.overview-site p {
  margin: 0;
}

.overview-clients > .overview-section-title {
  margin: 0 0 12px;
  color: var(--sg-graphite);
  font: 600 10px/1.2 var(--sg-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.overview-client {
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 10px;
  align-items: start;
  margin-top: 10px;
  border: 1px solid var(--sg-line);
  border-radius: 6px;
  padding: 14px;
  background: var(--sg-paper);
}

.overview-client.featured {
  border-color: color-mix(in srgb, var(--sg-blue) 72%, white);
}

.overview-dot {
  width: 7px;
  height: 7px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--sg-blue);
}

.overview-client-title,
.overview-tool-name strong,
.overview-tools-heading strong,
.overview-activity strong,
.overview-telemetry strong,
.overview-site-card strong,
.overview-site-title {
  font: 600 10px/1.35 var(--sg-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.overview-client p {
  margin-top: 7px;
  color: var(--sg-graphite);
  font-size: 12px;
  line-height: 1.4;
}

.overview-client small {
  display: block;
  margin-top: 6px;
  color: var(--sg-faint);
  font: 9px/1.4 var(--sg-mono);
}

.overview-connector {
  position: relative;
  align-self: stretch;
}

.overview-connector.inbound i,
.overview-connector.outbound i {
  position: absolute;
  display: block;
  height: 1px;
}

.overview-connector.inbound i {
  top: 50%;
  right: 6px;
  left: 6px;
  background: var(--sg-blue);
}

.overview-connector.inbound i::after,
.overview-connector.outbound i::after {
  position: absolute;
  top: -4px;
  right: 0;
  width: 7px;
  height: 7px;
  border-top: 1px solid currentColor;
  border-right: 1px solid currentColor;
  content: "";
  transform: rotate(45deg);
}

.overview-connector.inbound {
  color: var(--sg-blue);
}

.overview-connector.inbound span {
  position: absolute;
  top: calc(50% - 20px);
  left: 50%;
  font: 8px/1 var(--sg-mono);
  text-transform: uppercase;
  transform: translateX(-50%);
}

.overview-core {
  overflow: hidden;
  border: 1.5px solid var(--sg-ink);
  border-radius: 10px;
  background: #fcfcfa;
}

.overview-core > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  color: white;
  background: var(--sg-ink);
}

.overview-core-title {
  display: flex;
  gap: 10px;
  align-items: center;
  color: white;
  font: 28px/1.1 var(--sg-serif);
}

.overview-core-title span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sg-signal);
}

.overview-core > header p {
  color: #b9b9b2;
  font: 9px/1 var(--sg-mono);
  text-transform: uppercase;
}

.overview-core-body {
  padding: 16px;
}

.overview-tools-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}

.overview-tools-heading span {
  color: var(--sg-faint);
  font: 10px/1.4 var(--sg-sans);
}

.overview-tool {
  display: grid;
  grid-template-columns: 94px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin-top: 8px;
  border: 1px solid var(--sg-line);
  border-radius: 6px;
  padding: 12px;
  background: var(--sg-paper);
}

.overview-tool-name strong {
  display: block;
}

.overview-tool.read .overview-tool-name strong {
  color: var(--sg-blue);
}

.overview-tool.effect .overview-tool-name strong {
  color: var(--sg-signal);
}

.overview-tool-name code {
  display: block;
  margin-top: 5px;
  padding: 0;
  color: var(--sg-graphite);
  background: transparent;
  font-size: 11px;
}

.overview-tool-name small {
  display: block;
  margin-top: 4px;
  color: var(--sg-faint);
  font-size: 9px;
}

.overview-pipeline,
.overview-effect-pipelines {
  min-width: 0;
}

.overview-pipeline {
  display: flex;
  gap: 5px;
  align-items: center;
}

.overview-effect-pipelines {
  display: grid;
  gap: 7px;
}

.overview-pipeline i {
  flex: 0 0 auto;
  color: var(--sg-line-strong);
  font: normal 11px/1 var(--sg-mono);
}

.stage {
  flex: 0 0 auto;
  border: 1px solid var(--sg-line);
  border-radius: 4px;
  padding: 6px 7px;
  font: 8.5px/1 var(--sg-mono);
  white-space: nowrap;
}

.stage.validate {
  border-color: #cdd6f6;
  background: #f6f7fc;
}

.stage.execute {
  border-color: #f2c6b6;
  background: #fbedE8;
}

.stage.reliable {
  border-color: #e8cf92;
  background: #fff8ea;
}

.stage.verify {
  border-color: #bfdacd;
  background: #f2f8f5;
}

.overview-activity,
.overview-telemetry {
  display: grid;
  grid-template-columns: 88px 1fr auto;
  gap: 12px;
  align-items: center;
  margin-top: 12px;
}

.overview-activity span,
.overview-telemetry span {
  color: var(--sg-graphite);
  font-size: 11px;
  line-height: 1.45;
}

.overview-telemetry {
  border: 1px solid var(--sg-line);
  border-radius: 6px;
  padding: 10px 12px;
  background: #f6f6f4;
}

.overview-telemetry small {
  color: var(--sg-faint);
  font: 8px/1.2 var(--sg-mono);
  text-transform: uppercase;
  white-space: nowrap;
}

.overview-connector.outbound > div {
  position: absolute;
  right: 0;
  left: 0;
  height: 24px;
}

.overview-connector.outbound .effect-wire {
  top: 42%;
  color: var(--sg-signal);
}

.overview-connector.outbound .status-wire {
  top: 73%;
  color: var(--sg-green);
}

.overview-connector.outbound span {
  display: block;
  text-align: center;
  font: 8px/1 var(--sg-mono);
  text-transform: uppercase;
}

.overview-connector.outbound i {
  top: 15px;
  right: 6px;
  left: 6px;
  color: currentColor;
  background: currentColor;
}

.overview-site {
  align-self: stretch;
  border: 1.5px solid var(--sg-ink);
  border-top: 5px solid var(--sg-signal);
  border-radius: 7px;
  padding: 18px 14px 14px;
  background: var(--sg-paper);
}

.overview-site > header p {
  margin-top: 10px;
  font-family: var(--sg-serif);
  font-size: 19px;
  line-height: 1.2;
}

.overview-site-card {
  display: grid;
  gap: 10px;
  margin-top: 28px;
  border: 1px solid var(--sg-line);
  border-radius: 6px;
  padding: 14px;
  background: #fafaf8;
}

.overview-site-card span {
  font-size: 11px;
  line-height: 1.45;
}

.overview-site-card.ui {
  margin-top: 74px;
  border-color: #bfdacd;
  background: #f2f8f5;
}

.overview-site-card.ui strong {
  color: #217a51;
}

.overview-site > small {
  display: block;
  margin-top: 12px;
  color: var(--sg-faint);
  font: 8px/1.3 var(--sg-mono);
  text-align: center;
  text-transform: uppercase;
}

figcaption {
  margin-top: 12px;
  color: var(--sg-faint);
  font-size: 11px;
  line-height: 1.5;
}

@container (max-width: 920px) {
  .signett-overview-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .overview-clients {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .overview-clients > .overview-section-title {
    grid-column: 1 / -1;
  }

  .overview-client {
    margin: 0;
  }

  .overview-connector {
    min-height: 24px;
  }

  .overview-connector.inbound i {
    top: 4px;
    bottom: 4px;
    left: 50%;
    width: 1px;
    height: auto;
  }

  .overview-connector.inbound i::after {
    top: auto;
    right: -3px;
    bottom: 0;
    transform: rotate(135deg);
  }

  .overview-connector.inbound span {
    top: 8px;
    left: calc(50% + 26px);
  }

  .overview-connector.outbound {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .overview-connector.outbound > div {
    position: relative;
    top: auto !important;
    height: 24px;
  }

  .overview-connector.outbound i {
    top: 4px;
    bottom: 0;
    left: 50%;
    width: 1px;
    height: auto;
  }

  .overview-connector.outbound i::after {
    top: auto;
    right: -3px;
    bottom: 0;
    transform: rotate(135deg);
  }

  .overview-site-card.ui {
    margin-top: 14px;
  }
}

@container (max-width: 620px) {
  .overview-clients {
    grid-template-columns: 1fr;
  }

  .overview-tool {
    grid-template-columns: 1fr;
  }

  .overview-pipeline {
    flex-wrap: wrap;
  }

  .overview-activity,
  .overview-telemetry {
    grid-template-columns: 1fr;
    gap: 5px;
  }

  .overview-telemetry small {
    white-space: normal;
  }
}
</style>
