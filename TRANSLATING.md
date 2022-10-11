# Translating the Code for IBM i Documentation Web site.

## Translating is Contributing !

Translating the documentation Web site is contributing to Code For IBMI , so please read [CONTRIBUTING](CONTRIBUTING.md) before.

## Docsify
> A magical documentation site generator.

Code for IBMi uses [Docsify](https://docsify.js.org/#/) to publish the Web site [code-for-ibmi Documentation](https://halcyon-tech.github.io/vscode-ibmi/#/).

To sum it up , this tools transforms the **markdown** files stored in the [docs](./docs/) folder to a web site using [github pages](https://pages.github.com/).

This site is in English by default but it's possible to add a new langage to improve the learning curve of the none english's adopters.

Please read above How to initiate or How to help in a new translating. 

**Add a new langage** is to add a new folder under [docs](./docs/) folder with all docs's markdown files translated.
To be meaningful we call this folder with the [ISO Langage Code table](http://www.lingoes.net/en/translator/langcode.htm)  

So for french we used **fr-FR**.  
then the user switches between all the langages using the translations *navbar* in the right corner.

## Process to add a new langage
We choose to use french translation as an example to explain the process.  

1. Contributing  
    1. You fork and clone
    1. Create an new branch
1. Translating  
 :eye_speech_bubble: To make me easier the translating,I'm using this useful extension [Vscode Google Translate](https://marketplace.visualstudio.com/items?itemName=funkyremi.vscode-google-translate)  

    1. Add the new langage in the [navbar](./docs/_navbar.md) using the [ISO Langage Code table](http://www.lingoes.net/en/translator/langcode.htm). 
    1. Copy the [docs](./docs/) folder as the [/docs/fr-FR](./docs/fr-FR/) folder.
    1. Remove the _navbar.md under the [/docs/fr-FR](./docs/fr-FR/) folder. 
    1. Start translating the [side bar](./docs/fr-FR/_sidebar.md) 
        You have to cchange all the path to yours pages by adding the directory (/fr-FR/) in this case ..
        ```
        - [Code for IBM i](/)
          - [Login](/pages/login.md)
        ...  
        ```
        to 
        ```
        - [Code for IBM i](/fr-FR/)  
          - [Connexion](/fr-FR/pages/login.md)  
        ...  
        ```
    1. Then you can translate the [readme](./docs/fr-FR/README.md).
    1. Then you can test your job.
    1. And/or translate all the markdown files under your folder.
1. Testing locally
    1. Open a terminal in VSC
    1. Type 
    `docsify serve docs`
    1. Open your navigator on the url proposed
1. Testing Remotely
    1. Commit and push changes to your fork
    1. Deploy /docs of your fork to [github pages](https://docsify.js.org/#/deploy)          
3. :heavy_check_mark: Make a pull request (PR)

