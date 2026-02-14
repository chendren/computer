# Chart.js Patterns for LCARS

## Standard LCARS Chart Options

```json
{
  "responsive": true,
  "plugins": {
    "legend": {
      "labels": { "color": "#FF9900", "font": { "family": "Antonio" } }
    },
    "title": {
      "display": true,
      "text": "Title",
      "color": "#FF9900",
      "font": { "family": "Antonio", "size": 16 }
    }
  },
  "scales": {
    "x": {
      "ticks": { "color": "#FF9900" },
      "grid": { "color": "#333333" }
    },
    "y": {
      "ticks": { "color": "#FF9900" },
      "grid": { "color": "#333333" }
    }
  }
}
```

## Common Chart Types

- **Topic distribution**: Doughnut chart
- **Sentiment comparison**: Horizontal bar chart
- **Trends over time**: Line chart with fill
- **Multi-dimensional**: Radar chart
- **Frequency/count**: Vertical bar chart
- **Proportions**: Pie or polar area chart

## Color Array (cycle through for datasets)

```json
["#FF9900", "#CC99CC", "#9999FF", "#FF9966", "#CC6699", "#99CCFF", "#FFCC00"]
```
