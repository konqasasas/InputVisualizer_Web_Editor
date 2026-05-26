import { ElementStyle, InputStyleSet, PackBundle, TrailConfig, MousePadBackground } from './types';

export const defaultElementStyle: ElementStyle = {
  shape: 'rounded_rectangle',
  cornerRadius: 6,
  fillMode: 'filled_outline',
  fillColor: '#141820cc',
  borderColor: '#eaf2ffcc',
  borderWidth: 1,
  textColor: '#ffffff',
  opacity: 1,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  fontScale: 1,
  textShadow: false,
  horizontalAlign: 'center',
  verticalAlign: 'middle',
  textOffsetX: 0,
  textOffsetY: 0,
  shadow: { enabled: false, offsetX: 0, offsetY: 0, color: '#000000', alpha: 0 },
  glow: { enabled: false, color: '#66aaff', alpha: 0.35, size: 8 }
};

export const defaultInputStyles: InputStyleSet = {
  normal: defaultElementStyle,
  pressed: {
    ...defaultElementStyle,
    fillColor: '#f4f7ff',
    borderColor: '#ffffff',
    textColor: '#111318',
    glow: { enabled: false, color: '#ffffff', alpha: 0, size: 0 }
  },
  disabled: {
    ...defaultElementStyle,
    fillColor: '#3d1f2acc',
    borderColor: '#ff6a8acc',
    textColor: '#ffd6df',
    opacity: 0.78
  },
  pressAnimation: { enabled: true, type: 'scale_offset', durationMs: 70, scale: 0.94, offsetX: 0, offsetY: 0 },
  releaseEffect: { type: 'none', durationMs: 0, color: '#ffffff', alpha: 0, size: 0 }
};

export const defaultPadStyle: ElementStyle = {
  ...defaultElementStyle,
  shape: 'rounded_rectangle',
  cornerRadius: 10,
  fillColor: '#0f1218bb',
  borderColor: '#ffffff88',
  borderWidth: 1,
  shadow: { enabled: false, offsetX: 0, offsetY: 0, color: '#000', alpha: 0 },
  glow: { enabled: false, color: '#000', alpha: 0, size: 0 }
};

export const defaultBackground: MousePadBackground = {
  type: 'checkerboard',
  cellSize: 10,
  colorA: '#0b0f1680',
  colorB: '#11172280',
  scrollMode: 'fixed',
  backgroundOpacity: 0.35
};

export const defaultTrail: TrailConfig = {
  enabled: true,
  line: true,
  mode: 'wrap',
  sensitivity: 1,
  lifetimeMs: 850,
  smoothing: 'catmull_rom',
  colorMode: 'fixed',
  maxPoints: 1024,
  maxRenderedSamples: 2048,
  maxSmoothingSamples: 2048,
  baseWidth: 3.0,
  tailWidth: 0.15,
  color: '#eaf6ff',
  tailColor: '#55eaf6ff',
  glowColor: '#bbdfff',
  glowWidthMultiplier: 1,
  glow: { enabled: false },
  glowEnabled: false,
  maxTrailDistancePx: 165,
  followMode: 'instant',
  deadZoneRatio: 0.6,
  followResponsiveness: 9,
  resetMode: 'center_on_empty',
  dots: { enabled: false, spacing: 20, size: 2.4, color: '#eaf6ff', fadeWithAge: true },
  cursor: { type: 'dot', size: 5, color: '#eaf6ff' },
  lmbHighlight: { color: '#9edbff', widthMultiplier: 1, glowMultiplier: 1 },
  rmbHighlight: { color: '#ffc08a', widthMultiplier: 1, glowMultiplier: 1 }
};

export function createDefaultBundle(): PackBundle {
  const bundle = {
  "format": "input_visualizer_pack",
  "version": 1,
  "meta": {
    "id": "aqua",
    "name": "aqua",
    "author": "sasas_"
  },
  "settings": {
    "enabled": true,
    "activePack": "aqua_pulse_pro.ivizpack",
    "globalScale": 1,
    "globalOffsetX": 0,
    "globalOffsetY": 0,
    "globalOpacity": 1
  },
  "profile": {
    "canvas": {
      "referenceWidth": 854,
      "referenceHeight": 480,
      "backgroundColor": "#031018"
    },
    "elements": [
      {
        "type": "group",
        "id": "movement_cluster",
        "anchor": "bottom_left",
        "x": 4,
        "y": -4,
        "width": 120,
        "height": 144,
        "zIndex": 10,
        "children": [
          {
            "type": "key",
            "id": "W",
            "input": {
              "type": "keyCode",
              "code": "W"
            },
            "label": "W",
            "x": 42,
            "y": 0,
            "width": 36,
            "height": 36,
            "styleRef": "key",
            "style": {
              "pressed": {
                "textShadow": true,
                "textColor": "#ffffff",
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                }
              },
              "normal": {
                "textShadow": true
              },
              "disabled": {
                "textShadow": false
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "A",
            "input": {
              "type": "keyCode",
              "code": "A"
            },
            "label": "A",
            "x": 0,
            "y": 42,
            "width": 36,
            "height": 36,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "S",
            "input": {
              "type": "keyCode",
              "code": "S"
            },
            "label": "S",
            "x": 42,
            "y": 41,
            "width": 36,
            "height": 36,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "D",
            "input": {
              "type": "keyCode",
              "code": "D"
            },
            "label": "D",
            "x": 84,
            "y": 42,
            "width": 36,
            "height": 36,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "Ctrl",
            "input": {
              "type": "keyCode",
              "code": "CTRL"
            },
            "label": "Ctrl",
            "x": 0,
            "y": 84,
            "width": 57,
            "height": 27,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "Shift",
            "input": {
              "type": "keyCode",
              "code": "SHIFT"
            },
            "label": "Shift",
            "x": 64,
            "y": 84,
            "width": 57,
            "height": 28,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "releaseEffect": {
                "type": "none",
                "durationMs": 0,
                "alpha": 0,
                "size": 0
              }
            }
          },
          {
            "type": "key",
            "id": "Space",
            "input": {
              "type": "keyCode",
              "code": "SPACE"
            },
            "label": "Space",
            "x": 1,
            "y": 117,
            "width": 120,
            "height": 27,
            "styleRef": "key",
            "style": {
              "pressed": {
                "glow": {
                  "enabled": false,
                  "color": "#ffffff",
                  "alpha": 0,
                  "size": 0
                },
                "textColor": "#ffffff"
              },
              "pressAnimation": {
                "offsetX": 0,
                "offsetY": 0,
                "enabled": true,
                "type": "scale_offset",
                "scale": 0.94
              },
              "releaseEffect": {
                "alpha": 0,
                "type": "none",
                "durationMs": 0,
                "size": 0
              }
            }
          }
        ]
      },
      {
        "type": "group",
        "id": "mousepad",
        "x": -300,
        "y": -4,
        "width": 192,
        "height": 144,
        "children": [
          {
            "type": "mouse_pad",
            "id": "mouse_pad",
            "anchor": "bottom_right",
            "x": 0,
            "y": 0,
            "width": 192,
            "height": 144,
            "contentPadding": 9,
            "clipShape": "visualShape",
            "styleRef": "pad",
            "background": {
              "type": "none",
              "cellSize": 8,
              "colorA": "#03142086",
              "colorB": "#06223686",
              "backgroundOpacity": 0.48,
              "scrollMode": "fixed"
            },
            "trail": {
              "enabled": true,
              "line": true,
              "mode": "wrap",
              "sensitivity": 0.07,
              "lifetimeMs": 600,
              "smoothing": "chaikin",
              "colorMode": "button_state",
              "maxPoints": 1024,
              "maxRenderedSamples": 2048,
              "maxSmoothingSamples": 2048,
              "baseWidth": 4,
              "tailWidth": 0.13,
              "color": "#bff8ffff",
              "tailColor": "#21d7ff44",
              "glowColor": "#49e4ffff",
              "glow": {
                "enabled": false
              },
              "glowEnabled": false,
              "glowWidthMultiplier": 1,
              "maxTrailDistancePx": 165,
              "followMode": "instant",
              "deadZoneRatio": 0.6,
              "followResponsiveness": 9,
              "resetMode": "center_on_empty",
              "dots": {
                "enabled": false,
                "spacing": 18,
                "size": 2.2,
                "color": "#bff8ffff",
                "fadeWithAge": true
              },
              "cursor": {
                "type": "dot",
                "size": 5.4,
                "color": "#f2ffffff"
              },
              "lmbHighlight": {
                "color": "#bff8ffff",
                "widthMultiplier": 1,
                "glowMultiplier": 1
              },
              "rmbHighlight": {
                "color": "#bff8ffff",
                "widthMultiplier": 1,
                "glowMultiplier": 1
              }
            },
            "zIndex": 20,
            "style": {
              "cornerRadius": 6
            }
          }
        ],
        "anchor": "bottom_right"
      }
    ]
  },
  "theme": {
    "tokens": {},
    "styles": {
      "key": {
        "shape": "rounded_rectangle",
        "cornerRadius": 6,
        "fillMode": "filled_outline",
        "borderWidth": 1.4,
        "fontScale": 1,
        "textShadow": true,
        "horizontalAlign": "center",
        "verticalAlign": "middle",
        "textOffsetX": 0,
        "textOffsetY": 0,
        "shadow": {
          "enabled": true,
          "offsetX": 0,
          "offsetY": 3,
          "color": "#000000",
          "alpha": 0.38
        },
        "glow": {
          "enabled": false,
          "color": "#ffffff",
          "alpha": 0,
          "size": 0
        },
        "normal": {
          "fillColor": "#061925d0",
          "borderColor": "#37d7ffcc",
          "textColor": "#e9fbff",
          "opacity": 1,
          "scale": 1,
          "offsetX": 0,
          "offsetY": 0
        },
        "pressed": {
          "fillColor": "#48e1ffff",
          "borderColor": "#eaffffff",
          "textColor": "#001019",
          "opacity": 1,
          "scale": 0.92,
          "offsetX": 0,
          "offsetY": 1.3,
          "glow": {
            "enabled": false,
            "color": "#43ddff",
            "alpha": 0,
            "size": 0
          }
        },
        "disabled": {
          "fillColor": "#1a2432cc",
          "borderColor": "#4d6476aa",
          "textColor": "#9fb4c4",
          "opacity": 0.66,
          "scale": 1,
          "offsetX": 0,
          "offsetY": 0
        },
        "pressAnimation": {
          "enabled": true,
          "type": "scale_offset",
          "durationMs": 62,
          "scale": 0.92,
          "offsetX": 0,
          "offsetY": 1.3
        },
        "releaseEffect": {
          "type": "none",
          "durationMs": 0,
          "color": "#43ddff",
          "alpha": 0,
          "size": 0
        }
      },
      "mouse": {
        "shape": "rounded_rectangle",
        "cornerRadius": 8,
        "fillMode": "filled_outline",
        "borderWidth": 1.3,
        "fontScale": 0.82,
        "textShadow": true,
        "horizontalAlign": "center",
        "verticalAlign": "middle",
        "textOffsetX": 0,
        "textOffsetY": 0,
        "shadow": {
          "enabled": true,
          "offsetX": 1.4,
          "offsetY": 1.8,
          "color": "#000000",
          "alpha": 0.28
        },
        "glow": {
          "enabled": false,
          "color": "#ffffff",
          "alpha": 0,
          "size": 0
        },
        "normal": {
          "fillColor": "#061925d8",
          "borderColor": "#37d7ffbb",
          "textColor": "#e9fbff",
          "opacity": 1,
          "scale": 1,
          "offsetX": 0,
          "offsetY": 0
        },
        "pressed": {
          "fillColor": "#48e1ffff",
          "borderColor": "#ffffff",
          "textColor": "#001019",
          "opacity": 1,
          "scale": 0.94,
          "offsetX": 0,
          "offsetY": 1,
          "glow": {
            "enabled": false,
            "color": "#43ddff",
            "alpha": 0,
            "size": 0
          }
        },
        "disabled": {
          "fillColor": "#3d1f2acc",
          "borderColor": "#ff6a8acc",
          "textColor": "#ffd6df",
          "opacity": 0.78,
          "scale": 1,
          "offsetX": 0,
          "offsetY": 0
        },
        "pressAnimation": {
          "enabled": true,
          "type": "scale_offset",
          "durationMs": 72,
          "scale": 0.94,
          "offsetX": 0,
          "offsetY": 1
        },
        "releaseEffect": {
          "type": "none",
          "durationMs": 0,
          "color": "#ffffff",
          "alpha": 0,
          "size": 0
        }
      },
      "pad": {
        "shape": "rounded_rectangle",
        "cornerRadius": 12,
        "fillMode": "filled_outline",
        "fillColor": "#031420d0",
        "borderColor": "#37d7ffbb",
        "borderWidth": 1.3,
        "opacity": 1
      }
    }
  }
};
  return JSON.parse(JSON.stringify(bundle)) as PackBundle;
}

function adjustableGroup(storageKey: string) {
  return { enabled: true, storageKey, allowMove: true, allowScale: true, lockAnchor: true, minScale: 0.5, maxScale: 3 };
}

function key(id: string, code: string, label: string, x: number, y: number) {
  return { type: 'key' as const, id, input: { type: 'keyCode' as const, code }, label, x, y, width: 36, height: 36 };
}
