// Display-only estimate driven by the game timer; the server computes the real score on submit.
export function createPointsTicker(elementId, coinElementId) {
  let points = null;
  let receivedAt = 0;

  const element = () => document.getElementById(elementId);
  const coinElement = () => document.getElementById(coinElementId);

  return {
    update(next) {
      if (!next) return;
      points = next;
      receivedAt = Date.now();
      this.tick();
    },
    tick() {
      const el = element();
      if (!el || !points) return;
      const elapsed = points.elapsedSec + (Date.now() - receivedAt) / 1000;
      const steps = Math.floor(elapsed / points.timeStepSec);
      const timeFactor = Math.max(0, 1 - points.timeStepPenalty * steps);
      const factor = Math.max(points.floorRatio, timeFactor * points.nonTimeFactor);
      el.textContent = Math.round(points.base * factor);
      const coinEl = coinElement();
      if (coinEl) coinEl.textContent = Math.max(points.coinMin, Math.round(points.coinBase * factor));
    },
    reset() {
      points = null;
      const el = element();
      if (el) el.textContent = "-";
      const coinEl = coinElement();
      if (coinEl) coinEl.textContent = "-";
    },
  };
}

export function scoreSummary(scoring) {
  if (!scoring) return "";
  return `+${scoring.score} pts (base ${scoring.base} × ${Math.round(scoring.multiplier * 100)}%)`;
}
