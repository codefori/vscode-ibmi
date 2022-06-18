# Code for IBM i

[GitHub star this repo 🌟](https://github.com/halcyon-tech/vscode-ibmi) &nbsp;and [Sponsor development on GitHub 🤝](https://github.com/sponsors/worksofliam?frequency=recurring&sponsor=worksofliam)

<img src="./icon.png" align="right">

Maintain your RPGLE, CL, COBOL, C/CPP on IBM i right from Visual Studio Code. Edit and compile all ILE languages, view errors inline, content assist for RPGLE and CL, source date support, and much more. Code for IBM i has hundreds of daily users and over 6000 downloads. We strive on being open-source so we can best support our community.

* [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi) 💻
* [Support the project financially](https://github.com/sponsors/worksofliam) 🤝
* [Watch some tutorials](https://www.youtube.com/playlist?list=PLNl31cqBafCp-ml8WqPeriHWLD1bkg7KL) 📺
* [View our documentation](https://halcyon-tech.github.io/vscode-ibmi/#/) 📘
* [See who's contributed](https://github.com/halcyon-tech/vscode-ibmi/blob/master/CONTRIBUTING.md) 🕶️
* [See previous releases](https://github.com/halcyon-tech/vscode-ibmi/releases) 🔎
* Build from source (see below!) 🔨
* [Use our IBM i API in your own extension](https://github.com/halcyon-tech/vscode-ibmi/blob/master/docs/api/extending.md) 🛠

![https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi](https://img.shields.io/visual-studio-marketplace/v/HalcyonTechLtd.code-for-ibmi?style=flat-square) 
![https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi](https://img.shields.io/visual-studio-marketplace/i/HalcyonTechLtd.code-for-ibmi?style=flat-square) 
![](https://img.shields.io/visual-studio-marketplace/r/HalcyonTechLtd.code-for-ibmi?style=flat-square) 
![](https://img.shields.io/github/contributors/halcyon-tech/vscode-ibmi?style=flat-square) 
![](https://img.shields.io/github/issues-pr/halcyon-tech/vscode-ibmi?style=flat-square) 
![https://github.com/halcyon-tech/vscode-ibmi/issues](https://img.shields.io/github/issues/halcyon-tech/vscode-ibmi?style=flat-square)

---

### Building from source

1. This project requires VS Code and Node.js.
2. fork & clone repo
3. `npm i`
4. 'Run Extension' from vscode debug.

### Data collection

We do not collect any Personally identifiable information (PII). We do collect:

* When you connect to a system - but nothing about that system.
* The version of Visual Studio Code you're using.
* The version of the Code for IBM i you're using.
* The architecture of the machine you're using (e.g. Windows, Linux, Mac, Cloud, etc)

We do this for a few reasons:

1. Curious to see how many active users we have.
2. Allows us to see how often users are updating.
3. Let's us know what operating systems we should cater to (e.g. Windows vs Mac)

**You can disable this:** 

1. Open the VS Code settings (Control / Command + Comma)
2. Search `telemetry` and set `telemetry.telemetryLevel` to `none`.