import vscode from 'vscode';

export namespace SEUColors {
  interface Color {
    bytes: Buffer
    decoration: vscode.TextEditorDecorationType
  }

  const ColorDefinitions: Record<string, Color> = {
    blue: {
      bytes: Buffer.from([194, 154]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#3565cc`,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      })
    },
    blue_ri: {
      bytes: Buffer.from([194, 155]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#3565cc`,
        color: `white`,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      })
    },
    blue_ul: {
      bytes: Buffer.from([194, 158]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#3565cc`,
        textDecoration: `; border-bottom: 1px solid #3565cc;`
      })
    },
    green: {
      bytes: Buffer.from([194, 128]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#28d15d`,
      })
    },
    green_ri: {
      bytes: Buffer.from([194, 129]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#28d15d`,
        color: `black`,
      })
    },
    green_ul: {
      bytes: Buffer.from([194, 132]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#28d15d`,
        textDecoration: `; border-bottom: 1px solid #28d15d;`
      })
    },
    green_ul_ri: {
      bytes: Buffer.from([7]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#28d15d`,
        color: `black`,
        textDecoration: `; border-bottom: 1px solid black;`
      })
    },
    pink: {
      bytes: Buffer.from([194, 152]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#cf259c`,
      })
    },
    pink_ri: {
      bytes: Buffer.from([194, 153]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#cf259c`,
        color: `white`,
      })
    },
    pink_ul: {
      bytes: Buffer.from([20]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#cf259c`,
        textDecoration: `; border-bottom: 1px solid #cf259c;`
      })
    },
    pink_ul_ri: {
      bytes: Buffer.from([21]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#cf259c`,
        color: `white`,
        textDecoration: `; border-bottom: 1px solid white;`
      })
    },
    red: {
      bytes: Buffer.from([194, 136]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#cf2331`,
      })
    },
    // red_bl and red are the same
    red_bl: {
      bytes: Buffer.from([194, 138]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#cf2331`,
      })
    },
    red_ri: {
      bytes: Buffer.from([194, 137]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#cf2331`,
        color: `white`,
      }),
    },
    // red_ri_bl and red_ri are the same
    red_ri_bl: {
      bytes: Buffer.from([194, 139]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#cf2331`,
        color: `white`,
      }),
    },
    red_ul: {
      bytes: Buffer.from([194, 140]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#cf2331`,
        textDecoration: `; border-bottom: 1px solid #cf2331;`
      })
    },
    red_ri_ul: {
      bytes: Buffer.from([5]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#cf2331`,
        color: `white`,
        textDecoration: `; border-bottom: 1px solid white;`
      }),
    },
    turquoise: {
      bytes: Buffer.from([194, 144]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#22c4d6`,
      })
    },
    turquoise_ri: {
      bytes: Buffer.from([194, 145]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#22c4d6`,
        color: `black`,
      })
    },
    turquoise_ul: {
      bytes: Buffer.from([194, 148]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#22c4d6`,
        textDecoration: `; border-bottom: 1px solid #22c4d6;`
      })
    },
    // turquoise_ul_ri is the same as turquoise_ri
    turquoise_ul_ri: {
      bytes: Buffer.from([194, 149]),
      decoration: vscode.window.createTextEditorDecorationType({
        backgroundColor: `#22c4d6`,
        color: `black`,
        textDecoration: `; border-bottom: 1px solid black;`
      })
    },
    white: {
      bytes: Buffer.from([194, 130]),
      decoration: vscode.window.createTextEditorDecorationType({
        light: {
          color: `#000000`,
        },
        dark: {
          color: `#ffffff`,
        }
      })
    },
    white_ri: {
      bytes: Buffer.from([194, 131]),
      decoration: vscode.window.createTextEditorDecorationType({
        light: {
          color: `#ffffff`,
          backgroundColor: `#000000`,
        },
        dark: {
          color: `#000000`,
          backgroundColor: `#ffffff`,
        }
      })
    },
    white_ul: {
      bytes: Buffer.from([23]),
      decoration: vscode.window.createTextEditorDecorationType({
        light: {
          color: `#000000`,
          textDecoration: `; border-bottom: 1px solid #000000;`
        },
        dark: {
          color: `#ffffff`,
          textDecoration: `; border-bottom: 1px solid #ffffff;`
        }
      })
    },
    yellow: {
      bytes: Buffer.from([22]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#f4c842`,
      })
    },
    yellow_ri: {
      bytes: Buffer.from([194, 147]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#000000`,
        backgroundColor: `#f4c842`
      })
    },
    yellow_ul: {
      bytes: Buffer.from([194, 150]),
      decoration: vscode.window.createTextEditorDecorationType({
        color: `#f4c842`,
        textDecoration: `; border-bottom: 1px solid #f4c842;`
      })
    }
  };

  const colorMap = new Map();
  Object.entries(ColorDefinitions).forEach(c => {
    const colorName = c[0];
    const colorCode = c[1].bytes.toString(); // convert to string for use as Map key
    colorMap.set(colorCode, colorName);
  });

  export function getColorDef(bytesToCheck: Buffer) {
    return colorMap.get(bytesToCheck.toString());
  }

  export function forEach(cb: (name: string, color: Color) => void) {
    Object.entries(ColorDefinitions).forEach(c => cb(c[0], c[1]));
  }
}