# Code for IBM i

## IBM i development extension for VS Code

Maintain and compile your RPGLE, CL, COBOL, C/CPP on the IBM i right from Visual Studio Code.

![intro_01.png](assets/intro_01.png)

## Requirements

- SSH Daemon must be started on IBM i.
   - (Licensed program 5733-SC1 provides SSH support.)
   - `STRTCPSVR *SSHD` starts the daemon.
   - User `QSSHD` is enabled.
- Some familarity with VS Code. An introduction can be found [here](https://code.visualstudio.com/docs/getstarted/introvideos).

## Installation

From the Visual Studio Code Marketplace: [Code for IBM i](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi)

Or from the Extensions icon in the Activity Bar (on the left):
![assets/install_01,png](assets/install_01.png)

### Recommended Extensions

It's recommended you also install the [IBM i Development Pack](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.ibm-i-development-pack), a curated set of extensions built on or adding value to Code for IBM i. This includes database tools, RPGLE tools, COBOL tools, and more.

## Extension Development

1. clone repo
2. ```npm i```
3. 'Run extension' from VS Code debug.

## Getting Started

To work on this documentation:

- clone repo
- install docsify ```npm i docsify-cli -g```
- run local with ```docsify serve docs/```
- by default, runs on http://localhost:3000
- Read more about [Docsify](https://docsify.js.org/#/)
