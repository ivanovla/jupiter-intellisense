// ==UserScript==
// @name         Jupiter-intellisense
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=googleusercontent.com
// @grant        none
// ==/UserScript==
const LC_TOKEN_KEY = 'data-catalog-token';

let TOKEN = localStorage.getItem(LC_TOKEN_KEY);

const AI_PARAMETERS = {
    "temperature": 0.2,
    "maxOutputTokens": 256,
    "topP": 0.8,
    "topK": 40
};

const WINDOW_NAME = 'data-catalog';

const AI_URL = 'https://demo.data-catalog.qtidev.com/bff/api/v1/prediction';

const AUTH_URL = 'https://demo.data-catalog.qtidev.com/bff/api/v1/auth';

const DEBOUNCE_TIME = 400;


const CSS = `
        .intellisense{
            box-shadow: 0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23);
            position: absolute;
            overflow: auto;
            left: 73px;
            width: 400px;
            max-height: 200px;
            z-index: 222;
            background: white;
        }
        .intellisense_row{
          padding: 5px 10px;
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .intellisense_row:hover{
          background: rgb(238, 238, 238);
          cursor: pointer;
          transition: 0.2s;
        }
        #custom_overlay {
            display: block;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }

        #custom_popup {
            display: block;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 40vw;
            height: 80vh;
            background-color: white;
            z-index: 1;
        }

        #popup-iframe {
          width: 100%;
          height: 100%;
        }
    `;

class Utils {
    static debounce(func, wait, immediate) {
        let timeout;
        return function() {
            let context = this,
                args = arguments;
            let later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            let callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    }

    static findActiveTab() {
        const selector = document.querySelector('.lm-DockPanel-tabBar .lm-mod-current');
        return Utils.getExtensionByUrl(selector?.innerText);
    }

    static findTextBeforeCursor(cursorCoords, codeContainerEl) {
        if (!cursorCoords || !codeContainerEl) return;

        let codeItemsEl = [];
        codeContainerEl.querySelectorAll('pre>span').forEach(codeItem => {
            codeItem.childNodes.forEach(childNode => {
                codeItemsEl.push({
                    el: childNode,
                    coords: childNode.getBoundingClientRect ? childNode.getBoundingClientRect() : Utils.getCoordsBySiblings(childNode.previousSibling, childNode.nextSibling, codeItem)
                })
            })
        });

        let code = '';
        let lastCodeItem;

        for (let i = 0; i < codeItemsEl.length; i++) {
            const {x, y} = codeItemsEl[i].coords;
            const text = codeItemsEl[i].el.innerText || codeItemsEl[i].el.data;
            if ((cursorCoords.y > y) || (x < cursorCoords.x && y-cursorCoords.y < 3)) {
                code += `${text}`;
                lastCodeItem = codeItemsEl[i];
            } else {
                lastCodeItem = codeItemsEl[i-1];
                break;
            }
        }

        return {code, lastCodeItem};
    }

    static getSuggestions({content, signal}) {
        return fetch(AI_URL, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TOKEN}`
            },
            signal,
            body: JSON.stringify(
                {
                    "instances": [
                        {
                            "content": content
                        }
                    ],
                    "parameters": AI_PARAMETERS
                }
            )})
            .then(result => {
                if (result.status >= 200 && result.status < 300) {
                    return result.json();
                } else {
                    throw new Error(result.status)
                }
            })
    }

    static getCoordsBySiblings(previous, next, parent) {
        const parentCoords = parent.getBoundingClientRect();
        const previousCoords = previous?.getBoundingClientRect();
        const nextCoords = next?.getBoundingClientRect();
        return {
            x: previousCoords? previousCoords.x + 1: nextCoords ? nextCoords.x -1 : parentCoords.x,
            y: previousCoords?.y || parentCoords.y
        }
    }

    static getExtensionByUrl(url) {
        if (!url) return;
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        const extension = lastPart.split('.')[1];
        return extension;
    }
    static waitForElm(selector) {
        return new Promise(resolve => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }

            const observer = new MutationObserver(mutations => {
                if (document.querySelector(selector)) {
                    resolve(document.querySelector(selector));
                    observer.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }
    static openWindow(url, callback) {
        let windowObjectReference = null;
        let previousUrl = null;
        const openSignInWindow = (url, name) => {
            // remove any existing event listeners
            window.removeEventListener('message', callback);

            // window features
            const strWindowFeatures =
                'toolbar=no, menubar=no, width=600, height=700, top=100, left=100';

            if (windowObjectReference === null || windowObjectReference.closed) {
                /* if the pointer to the window object in memory does not exist
                 or if such pointer exists but the window was closed */
                windowObjectReference = window.open(url, name, strWindowFeatures);
            } else if (previousUrl !== url) {
                /* if the resource to load is different,
                 then we load it in the already opened secondary window and then
                 we bring such window back on top/in front of its parent window. */
                windowObjectReference = window.open(url, name, strWindowFeatures);
                windowObjectReference.focus();
            } else {
                /* else the window reference must exist and the window
                 is not closed; therefore, we can bring it back on top of any other
                 window with the focus() method. There would be no need to re-create
                 the window or to reload the referenced resource. */
                windowObjectReference.focus();
            }

            // add the listener for receiving a message from the popup
            window.addEventListener('message', event => callback(event), false);
            // assign the previous URL
            previousUrl = url;
        };

        openSignInWindow(url)
    }
    static openPopup(url, name) {
        const overlay = document.createElement('div');
        overlay.id = 'custom_overlay';
        const popup = document.createElement('div');
        popup.id = 'custom_popup';
        const iframe = document.createElement('iframe');
        iframe.id = 'popup-iframe';
        iframe.src = url;
        popup.appendChild(iframe);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);
    }

    static closePopup() {
        document.querySelector('#custom_overlay')?.remove();
        document.querySelector('#custom_popup')?.remove();
    }
}

class ExtensionFactory {
    instances = new Proxy({
        'ipynb': IPYNB
    }, {
        get(target, prop, receiver) {
            if (target[prop]) {
                return new target[prop]();
            }
            return null;
        },
    });
    create(extension) {
        return this.instances[extension];
    }
}

class Intellisense {
    _ref;
    constructor({children, parent, onChange, insertingPlace}) {
        const wrapper = document.createElement('div');
        wrapper.classList.add('intellisense');
        wrapper.style.top = `${parseInt(30 + insertingPlace.coords.y - parent.getBoundingClientRect().y)}px`;
        this._ref = wrapper;

        const documentFragment = document.createDocumentFragment();
        children.forEach(child => {
            const row = document.createElement('div');
            row.classList.add('intellisense_row');
            row.innerText = child.content;
            row.onclick = (e) => {
                onChange(e);
                this.destroy();
            }
            documentFragment.appendChild(row);
        });
        wrapper.appendChild(documentFragment);
        parent.append(wrapper);
    }

    destroy() {
        this._ref.remove();
    }
}

class IPYNB {
    controller;
    constructor() {
        this.handleChangeCodeRow = Utils.debounce(this.changeRow.bind(this), DEBOUNCE_TIME);
        this.onKeyup = (e) => {
            this.deleteIntellisense();
            this.handleChangeCodeRow(e)
        }
        this.onHotKeys = this.pressOnHotKeys.bind(this);
        this.onClickOutside = this.handleClickOutsideIntellisense.bind(this);
        this.onMessage = this.handleMessage.bind(this);
        this.addListeners();
    }

    abortPreviousRequest() {
        if (this.controller) this.controller.abort();
    }
    addListeners() {
        document.querySelector('.lm-DockPanel').addEventListener('keyup', this.onKeyup);
        document.body.addEventListener('keyup', this.onHotKeys);
        document.body.addEventListener('click', this.onClickOutside);
        window.addEventListener('message', this.onMessage);
    }
    changeRow(e) {
        const parent = e.target.closest('.CodeMirror');
        if (!parent) {
            console.warn("I can't find parent CodeMirror");
            return;
        }
        const codeContainer = parent.querySelector(".CodeMirror-scroll .CodeMirror-code");
        if (!codeContainer) {
            console.warn("I can't find children code container");
            return;
        }
        const cursorEl = parent.querySelector('.CodeMirror-cursors>.CodeMirror-cursor');
        if (!cursorEl) {
            console.warn("I can't find cursor element");
            return;
        }
        const cursorCoords = cursorEl.getBoundingClientRect();
        const codeBeforeCursor = Utils.findTextBeforeCursor(cursorCoords, codeContainer);
        if (codeBeforeCursor.code) {
            const parentForIntellisense = e.target.closest('.lm-Widget .p-Widget .lm-Panel .p-Panel .jp-Cell-inputWrapper')
            this.showIntellisense({
                codeString: codeBeforeCursor.code,
                parent: parentForIntellisense,
                insertingPlace: codeBeforeCursor.lastCodeItem,
                cursorCoords
            });
        }
    }

    createIntellisenseRowHandler = (insertingPlace, cursorCoords) => {
        return (e) => {
            navigator.clipboard.writeText(`
                ${e.target.innerText}`);

            const pasteEvent = new ClipboardEvent('paste', {
                clipboardData: new DataTransfer(),
                bubbles: true,
                cancelable: true,
                composed: true
            });

            pasteEvent.clipboardData.setData('text/plain', e.target.innerText);

            insertingPlace.el.dispatchEvent(pasteEvent)
        }
    }

    deleteIntellisense() {
        const intellisenses = document.querySelectorAll('.intellisense');
        if (intellisenses.length) {
            intellisenses.forEach(e => e.remove());
        }
    }

    destroy() {
        this.removeListeners();
    }

    handleClickOutsideIntellisense(e) {
        this.abortPreviousRequest();
        const isClickOnIntellisense = e.target.closest('intellisense');
        if (!isClickOnIntellisense) {
            this.deleteIntellisense();
        }
    }

    handleMessage(e) {
        try {
            const {command, value} = JSON.parse(e.data);
            if (command === 'token') {
                localStorage.setItem(LC_TOKEN_KEY, value);
                TOKEN = value;
            }
        }catch (e) {
            console.error(e);
        }
    }

    pressOnHotKeys(evt) {
        evt = evt || window.event;
        if (evt.keyCode == 27) {
            this.deleteIntellisense();
        }
    }

    removeListeners() {
        document.querySelector('.lm-DockPanel').removeEventListener('keyup', this.onKeyup);
        document.body.removeEventListener('keyup', this.onHotKeys);
        document.body.removeEventListener('click', this.onClickOutside);
        window.removeEventListener('message', this.onMessage);

    }
    async showIntellisense({codeString, parent, insertingPlace, cursorCoords}) {
        this.abortPreviousRequest();
        this.controller = new AbortController();
        try {
            const result = await Utils.getSuggestions({content: `${codeString}`,
                signal: this.controller.signal});
            if (result?.predictions && result.predictions[0]?.content) {
                const intellisense = new Intellisense({
                    parent,
                    children: result.predictions,
                    onChange: this.createIntellisenseRowHandler(insertingPlace, cursorCoords),
                    insertingPlace
                });
            }
        } catch (e) {
            if (+e.message === 401) {
                Utils.openWindow(AUTH_URL, this.handleMessage);
            }
        }
    }
}

(function() {
    'use strict';
    const pushState = history.pushState;
    let extension;
    const extensionFactory = new ExtensionFactory();

    const style = document.createElement('style');

    if (style.styleSheet) {
        style.styleSheet.cssText = CSS;
    } else {
        style.appendChild(document.createTextNode(CSS));
    }

    document.getElementsByTagName('head')[0].appendChild(style);

    history.pushState = function(state, unused, url) {
        if (typeof history.onpushstate == "function") {
            history.onpushstate({state: state});
        }
        const ext = Utils.getExtensionByUrl(url) || Utils.findActiveTab();
        if (ext) {
            extension?.destroy();
            extension = extensionFactory.create(ext) || extension;
        }
        return pushState.apply(history, arguments);
    };

    Utils.waitForElm('.lm-DockPanel-tabBar').then((elm) => {
        console.log('Element is ready');
    });
})();
