// Shared Chart.js theme so every chart in SeaGuard matches the design system.
(() => {
  if (typeof Chart === 'undefined') return;
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = token('--muted', '#526171');
  Chart.defaults.borderColor = token('--border', '#dfe6ed');
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1d1d1f';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = {weight: '600'};
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 4;
  window.SeaGuardPalette = ['#0071e3', '#248a3d', '#b25000', '#d70015', '#5e5ce6', '#1d1d1f'];
})();
