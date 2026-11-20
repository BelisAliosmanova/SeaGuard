// Shared Chart.js theme and monthly water series.
(() => {
  'use strict';
  if (typeof Chart === 'undefined') return;
  const css = getComputedStyle(document.documentElement);
  const token = name => css.getPropertyValue(name).trim();
  Chart.defaults.font.family = token('--sans');
  Chart.defaults.font.size = 11;
  Chart.defaults.color = token('--muted');
  Chart.defaults.borderColor = token('--border');
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = token('--paper');
  Chart.defaults.plugins.tooltip.titleColor = token('--ink');
  Chart.defaults.plugins.tooltip.bodyColor = token('--ink');
  Chart.defaults.plugins.tooltip.footerColor = token('--muted');
  Chart.defaults.plugins.tooltip.borderColor = token('--control');
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = {weight: '600'};
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 4;
  window.SeaGuardPalette = ['--chart-light', '--chart-turbidity', '--chart-chlorophyll',
    '--risk-high', '--chart-reference', '--risk-low'].map(token);

  const metrics = {
    lightAtDepth: {label: 'Светлина до дъното', unit: '%', color: token('--chart-light')},
    turbidity: {label: 'Мътност', unit: 'FNU', color: token('--chart-turbidity')},
    chlorophyll: {label: 'Хлорофил-а', unit: 'mg/m³', color: token('--chart-chlorophyll')}
  };
  const valueFormat = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 1});
  const monthFormat = new Intl.DateTimeFormat('bg-BG', {month: 'long', timeZone: 'UTC'});
  const longFormat = new Intl.DateTimeFormat('bg-BG', {month: 'long', year: 'numeric', timeZone: 'UTC'});
  const monthDate = month => new Date(month + '-01T00:00:00Z');
  const monthLabel = month => longFormat.format(monthDate(month));
  const format = (value, metric) => `${valueFormat.format(value)} ${metrics[metric].unit}`;

  function plot(canvas, {months, metric, primary, reference, limits = []}) {
    clear(canvas);
    const cfg = metrics[metric];
    const datasets = [{
      label: primary.label, data: primary.values, borderColor: cfg.color, pointBackgroundColor: cfg.color,
      backgroundColor: context => {
        const {ctx, chartArea} = context.chart;
        if (!chartArea) return cfg.color + '35';
        const fill = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        fill.addColorStop(0, cfg.color + '42');
        fill.addColorStop(1, cfg.color + '04');
        return fill;
      }, fill: true, pointStyle: 'circle', pointRadius: 3, tension: .26, cubicInterpolationMode: 'monotone'
    }];
    if (reference?.values.some(Number.isFinite)) {
      const color = token('--chart-reference');
      datasets.push({label: reference.label, data: reference.values, borderColor: color,
        backgroundColor: color, borderDash: [5, 4], pointStyle: 'dash', tension: .26,
        cubicInterpolationMode: 'monotone'});
    }
    const bands = {
      id: 'monthlyThresholds',
      beforeDatasetsDraw({ctx, chartArea, scales}) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.font = '500 10px ' + Chart.defaults.font.family;
        ctx.textAlign = 'right';
        for (const [value, color] of limits) {
          const y = scales.y.getPixelForValue(value);
          if (y < chartArea.top + 12 || y > chartArea.bottom) continue;
          ctx.strokeStyle = token(color);
          ctx.fillStyle = token(color);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
          ctx.fillText(format(value, metric), chartArea.right - 4, y - 4);
        }
        ctx.restore();
      }
    };
    return new Chart(canvas, {
      type: 'line',
      data: {labels: months.map(month => monthFormat.format(monthDate(month)).slice(0, 3)), datasets},
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: {mode: 'index', intersect: false},
        plugins: {
          legend: {display: datasets.length > 1, position: 'bottom', align: 'start', labels: {padding: 10}},
          tooltip: {callbacks: {
            title: items => monthLabel(months[items[0].dataIndex]),
            label: item => `${item.dataset.label} · ${format(item.parsed.y, metric)}`
          }}
        },
        scales: {
          x: {grid: {display: false}, border: {display: false}, ticks: {maxRotation: 0}},
          y: {
            beginAtZero: true, suggestedMax: Math.max(...limits.map(([value]) => value), 0),
            border: {display: false}, ticks: {maxTicksLimit: 5, callback: value => format(value, metric)},
            grid: {drawTicks: false}
          }
        }
      },
      plugins: [bands]
    });
  }

  function clear(canvas) { Chart.getChart(canvas)?.destroy(); }

  window.SeaGuardWaterChart = {metrics, plot, clear, format, monthLabel};
})();
