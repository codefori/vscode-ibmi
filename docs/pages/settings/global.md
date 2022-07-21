## Settings: Global

These are setting  which affect the extension (and therefore *every* connection). To adjust the extension's global setting,  either:

- Use the standard VS Code <kbd>Ctrl</kbd> + <kbd>,</kbd> and click Extensions
- or click File/Preferences/Settings and click Extensions
-or  press <kbd>F1</kbd>, search for ```Preferences: Open Settings (UI)``` and click extensions.

Settings for the extension will be under ```Code for IBM i```

![assets/settings_01.png](assets/settings_01.png)

Most of the setting have a self explanatory description. A few have notes below.

**It is not recommended editing the JSON manually. If you do, restart/reload VS Code so Code for IBM i can pickup the changes.**

### Actions

Actions can be edited in settings.json, but also more easily by clicking **Actions** in the status bar. See *Actions*, above.

### Connections

Connections can be edited in settings.json, but you'd typically add additional connections as in *Connect First Time*, above.

### Connection Settings

These are the various setting relating to the items in the browsers, e.g., the list of source files in the OBJECT BROWSER. While these can be edited in settings.json, most can be more easily maintained by clicking or right clicking on an item in the browser.

### Log Compile Output

When enabled, spool files will be logged from the command execution.
These spool files can be found under the **OUTPUT** tab (View->Output, or Ctrl + Shift + U). Select **IBM i Output** in the drop down on the right.

![Panel on Right](assets/LogOutput_01.png)

You can clear the OUTPUT tab using the **Clear Output** icon on the right.
![Clear output](assets/LogOutput_02.png)

You can change the font size in the OUTPUT tab in your settings.json thus:

````json
"[Log]": {
        "editor.fontSize": 11
    },
````