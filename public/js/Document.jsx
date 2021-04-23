import React from 'react';
import Immutable from 'immutable';
import {EditorState, Editor, ContentState, SelectionState, Modifier, convertToRaw, convertFromRaw, RichUtils, getDefaultKeyBinding, CompositeDecorator, Entity} from 'draft-js';
import {CustomContext} from './CustomContext.jsx';
import {PopPanel} from './PopPanel.jsx';
import FormatAlignLeftIcon from '@material-ui/icons/FormatAlignLeft';
import FormatAlignRightIcon from '@material-ui/icons/FormatAlignRight';
import FormatAlignCenterIcon from '@material-ui/icons/FormatAlignCenter';
import FormatAlignJustifyIcon from '@material-ui/icons/FormatAlignJustify';
import FormatLineSpacingIcon from '@material-ui/icons/FormatLineSpacing';
import {Globals} from './Globals.jsx';
import PropTypes from 'prop-types';

const addMenu = [
  {label: 'Tag', classes: ['item', 'parent', 'closed'], subitems: [
    {label: 'Character', type: Globals.COMM_TYPE_NEWCHAR, classes: ['item', 'child', 'hidden']},
    {label: 'Place', type: Globals.COMM_TYPE_NEWPLACE, classes: ['item', 'child', 'hidden']},
    {label: 'Event', type: Globals.COMM_TYPE_NEWEVENT, classes: ['item', 'child', 'hidden']}
  ]},
  {label: 'Wikipedia', type: Globals.COMM_TYPE_NEWWIKI, classes: ['item']},
  {label: 'Link', type: Globals.COMM_TYPE_NEWLINK, classes: ['item']}
];

const editMenu = [
  {label: 'Delete', classes: ['item'], type: Globals.COMM_TYPE_EDITCHAR}
];

const associationNames = new Map();
associationNames.set(Globals.COMM_TYPE_NEWCHAR, 'character');
associationNames.set(Globals.COMM_TYPE_NEWPLACE, 'place');
associationNames.set(Globals.COMM_TYPE_NEWEVENT, 'event');
associationNames.set(Globals.COMM_TYPE_NEWWIKI, 'wiki');
associationNames.set(Globals.COMM_TYPE_NEWLINK, 'link');

const lineSpacings = new Map();
lineSpacings.set('lineheight_single', 1);
lineSpacings.set('lineheight_medium', 1.5);
lineSpacings.set('lineheight_double', 2);

/**
 * Represents a document containing a work of fiction.
 */
export class Document extends React.Component {
  /**
   * constructor
   *
   * @param {Object} props
  **/
  constructor(props) {
    super(props);

    const dpi = this.getDPI();
    this.refHandles = [];

    this.state = {
      pages: [],
      pageWidth: 8.25 * dpi,
      pageHeight: 11.75 * dpi,
      topMargin: 1 * dpi,
      leftMargin: 1 * dpi,
      rightMargin: 1 * dpi,
      bottomMargin: 1 * dpi,
      currentLineHeight: 'lineheight_double',
      leftOn: true,
      centerOn: false,
      rightOn: false,
      justifyOn: false,
      selectedText: '',
      associations: [],
      loading: true,
      selectedAssociation: ''
    };
    this.storyID = props.storyID;
    this.rightclickAddMenu = React.createRef();
    this.rightclickEditMenu = React.createRef();
    this.popPanel = React.createRef();
    this.maxWidth = this.state.pageWidth - (this.state.leftMargin + this.state.rightMargin);
    this.currentPage = 0;
    this.SAVE_TIME_INTERVAL = 5000;
    this.socket = null;
    this.deletePressed = false;
    this.pendingEdits = new Map();
    this.pendingPageDeletions = [];
    this.checkSaveInterval = setInterval(() => this.checkForPendingEdits(), this.SAVE_TIME_INTERVAL);
  }

  /**
   * proptypes for lint
   */
  static get propTypes() {
    return {
      storyID: PropTypes.string,
    };
  }

  /**
   * Find entities in block
   *
   * @param {string} type
   * @param {ContentBlock} contentBlock
   * @param {function} callback
   */
  findEntity(type, contentBlock, callback) {
    contentBlock.findEntityRanges((character) => {
      const entityKey = character.getEntity();
      return (entityKey !== null && Entity.get(entityKey).getType() === type);
    }, callback);
  }

  /**
   * Create decorators from an array of text associations and
   * assign their click methods.
   *
   * @return {Object} The composite decorator
   */
  createDecorators() {
    console.log('make decorator for', this.state.associations);
    const decorators = [];
    for (let i=0; i < this.state.associations.length; i++) {
      switch (this.state.associations[i].type) {
        case Globals.ASSOCIATION_TYPE_CHARACTER:
          decorators.push({
            strategy: this.findCharacter.bind(this),
            component: CharacterSpan,
            props: {
              leftclickFunc: this.clickedCharacter.bind(this),
              rightclickFunc: this.clickedCharacterContext.bind(this)
            }
          });
          break;
        case Globals.ASSOCIATION_TYPE_PLACE:
          decorators.push({
            strategy: this.findPlace.bind(this),
            component: PlaceSpan,
            props: {
              leftclickFunc: this.clickedPlace.bind(this),
              rightclickFunc: this.clickedPlaceContext.bind(this)
            }
          });
          break;
        case Globals.ASSOCIATION_TYPE_EVENT:
          decorators.push({
            strategy: this.findEvent.bind(this),
            component: EventSpan,
            props: {
              leftclickFunc: this.clickedEvent.bind(this),
              rightclickFunc: this.clickedEventContext.bind(this)
            }
          });
          break;
      }
    }
    return new CompositeDecorator(decorators);
  }

  /**
   * Triggered when an association of type 'character' is clicked
   *
   * @param {string} label - the clicked-on text
   */
  clickedCharacter(label) {
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.popPanel.current.updateAndDisplay(assocObj[0].id);
  }

  /**
   * Triggered when clicking on 'new character' from the right-click
   * context menu while document text is highlighted.
   *
   * @param {event} event
   * @param {string} label - the selected text
   */
  clickedCharacterContext(event, label) {
    event.preventDefault();
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.setState({
      selectedAssociation: assocObj[0].id
    }, () => {
      this.rightclickEditMenu.current.updateAndDisplay(event.pageX, event.pageY);
    });
  }

  /**
   * Triggered when an association of type 'place' is clicked
   *
   * @param {string} label - the clicked-on text
   */
  clickedPlace(label) {
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.popPanel.current.updateAndDisplay(assocObj[0].id);
  }

  /**
   * Triggered when clicking on 'new place' from the right-click
   * context menu while document text is highlighted.
   *
   * @param {event} event
   * @param {string} label - the selected text
   */
  clickedPlaceContext(event, label) {
    event.preventDefault();
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.setState({
      selectedAssociation: assocObj[0].id
    }, () => {
      this.rightclickEditMenu.current.updateAndDisplay(event.pageX, event.pageY);
    });
  }

  /**
   * Triggered when an association of type 'event' is clicked
   *
   * @param {string} label - the clicked-on text
   */
  clickedEvent(label) {
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.popPanel.current.updateAndDisplay(assocObj[0].id);
  }

  /**
   * Triggered when clicking on 'new event' from the right-click
   * context menu while document text is highlighted.
   *
   * @param {event} event
   * @param {string} label - the selected text
   */
  clickedEventContext(event, label) {
    event.preventDefault();
    const assocObj = this.state.associations.filter((assoc) => {
      if (this.matchAlias(assoc, label)) {
        return assoc;
      }
      if (!assoc.details.caseSensitive) {
        return assoc.name.toLowerCase() == label.toLowerCase();
      }
      return assoc.name == label;
    });
    this.setState({
      selectedAssociation: assocObj[0].id
    }, () => {
      this.rightclickEditMenu.current.updateAndDisplay(event.pageX, event.pageY);
    });
  }

  /**
   * Check an association object for a matching alias property
   *
   * @param {Object} assoc
   * @param {string} label
   * @return {boolean}
   */
  matchAlias(assoc, label) {
    if (assoc.details.aliases.length) {
      const aliases = assoc.details.aliases.split(',');
      for (let i=0; i < aliases.length; i++) {
        if (!assoc.details.caseSensitive) {
          if (aliases[i].toLowerCase() == label.toLowerCase()) {
            return true;
          }
        }
        if (aliases[i] == label) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Generate the regex match string for associations.
   *
   * @param {string} string
   * @return {string}
   */
  getRegexString(string) {
    return '(' + string + ')+[(?!,.\'-)|(\\s)]+';
  }

  /**
   * Find entities of type character in block
   *
   * @param {ContentBlock} contentBlock
   * @param {function} callback
   * @param {ContentState} contentState
   */
  findCharacter(contentBlock, callback, contentState ) {
    const text = contentBlock.getText();
    for (let i=0; i < this.state.associations.length; i++) {
      if (!this.state.associations[i].name.trim().length) {
        return;
      }
      if (this.state.associations[i].type == Globals.ASSOCIATION_TYPE_CHARACTER) {
        let match;
        const deets = this.state.associations[i].details;
        const toArray = deets.aliases.split(',');
        for (let z=0; z < toArray.length; z++) {
          const alias = toArray[z].trim();
          const regexStr = this.getRegexString(alias);
          let caseFlag = 'g';
          if (!deets.caseSensitive) {
            caseFlag = 'gi';
          }
          const regex = new RegExp(regexStr, caseFlag);
          while ((match = regex.exec(text)) !== null) {
            const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
            callback(start, start + alias.length);
          }
        }

        const name = this.state.associations[i].name.trim();
        const regexStr = this.getRegexString(name);
        let caseFlag = 'g';
        if (!deets.caseSensitive) {
          caseFlag = 'gi';
        }
        const regex = new RegExp(regexStr, caseFlag);
        while ((match = regex.exec(text)) !== null) {
          const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
          callback(start, start + name.length);
        }
      }
    }
  }

  /**
   * Find entities of type place in block
   *
   * @param {ContentBlock} contentBlock
   * @param {function} callback
   * @param {ContentState} contentState
   */
  findPlace(contentBlock, callback, contentState ) {
    const text = contentBlock.getText();
    for (let i=0; i < this.state.associations.length; i++) {
      if (!this.state.associations[i].name.trim().length) {
        return;
      }
      if (this.state.associations[i].type == Globals.ASSOCIATION_TYPE_PLACE) {
        let match;
        const deets = this.state.associations[i].details;
        const toArray = deets.aliases.split(',');
        for (let z=0; z < toArray.length; z++) {
          const alias = toArray[z].trim();
          const regexStr = this.getRegexString(alias);
          let caseFlag = 'g';
          if (!deets.caseSensitive) {
            caseFlag = 'gi';
          }
          const regex = new RegExp(regexStr, caseFlag);
          while ((match = regex.exec(text)) !== null) {
            const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
            callback(start, start + alias.length);
          }
        }
        const name = this.state.associations[i].name.trim();
        const regexStr = this.getRegexString(name);
        let caseFlag = 'g';
        if (!deets.caseSensitive) {
          caseFlag = 'gi';
        }
        const regex = new RegExp(regexStr, caseFlag);
        while ((match = regex.exec(text)) !== null) {
          const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
          callback(start, start + name.length);
        }
      }
    }
  }

  /**
   * Find entities of type event in block
   *
   * @param {ContentBlock} contentBlock
   * @param {function} callback
   * @param {ContentState} contentState
   */
  findEvent(contentBlock, callback, contentState ) {
    const text = contentBlock.getText();
    for (let i=0; i < this.state.associations.length; i++) {
      if (!this.state.associations[i].name.trim().length) {
        return;
      }
      if (this.state.associations[i].type == Globals.ASSOCIATION_TYPE_EVENT) {
        let match;
        const deets = this.state.associations[i].details;
        const toArray = deets.aliases.split(',');
        for (let z=0; z < toArray.length; z++) {
          const alias = toArray[z].trim();
          const regexStr = this.getRegexString(alias);
          let caseFlag = 'g';
          if (!deets.caseSensitive) {
            caseFlag = 'gi';
          }
          const regex = new RegExp(regexStr, caseFlag);
          while ((match = regex.exec(text)) !== null) {
            const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
            callback(start, start + alias.length);
          }
        }

        const name = this.state.associations[i].name.trim();
        const regexStr = this.getRegexString(name);
        let caseFlag = 'g';
        if (!deets.caseSensitive) {
          caseFlag = 'gi';
        }
        const regex = new RegExp(regexStr, caseFlag);
        while ((match = regex.exec(text)) !== null) {
          const start = match.index + match[0].length - match[0].replace(/^\s+/, '').length;
          callback(start, start + name.length);
        }
      }
    }
  }

  /** componentDidMount **/
  componentDidMount() {
    this.fetchWebsocketURL();
    window.addEventListener('beforeunload', this.beforeunload.bind(this));
    this.fetchAssociations().then( () => {
      this.fetchDocumentPages();
    });
  }

  /** beforeunload **/
  beforeunload() {
    if (this.socket.isOpen) {
      this.socket.close();
    }
  }

  /**
   * Init websocket and assign handlers
   *
   * @param {string} url
   */
  setupWebsocket(url) {
    this.socket = new WebSocket(url);
    this.socket.isOpen = false;

    this.socket.onopen = (event) => {
      this.socket.isOpen = true;
      console.log('opened', this.socket);
    };
    this.socket.onclose = (event) => {
      console.log('socket closed', event);
      this.socket.isOpen = false;
      setTimeout(this.setupWebsocket, 500, url);
    };
    this.socket.onerror = (event) => {
      console.error('socket error', event);
      this.socket.isOpen = false;
      setTimeout(this.setupWebsocket, 5000, url);
    };
    this.socket.onmessage = (event) => {
      console.log('Message from server', JSON.parse(event.data));
      this.processSocketMessage(JSON.parse(event.data));
    };
  }

  /**
   * Force draftJS to redraw its decorators, needed for
   * when the list of associations is updated by the user.
   */
  forceRender() {
    const newPages = [...this.state.pages];
    this.setFocus(this.currentPage);
    for (let i=0; i < this.state.pages.length; i++) {
      const editorState = this.state.pages[i].editorState;
      newPages[i].editorState = EditorState.set(editorState, {decorator: this.createDecorators()});
      if (i == this.currentPage) {
        const selection = editorState.getSelection();
        const state = editorState.getCurrentContent();
        const block = state.getBlockForKey(selection.getEndKey());
        const deselection = new SelectionState({
          anchorKey: block.getKey(), // key of block
          anchorOffset: selection.getEndOffset(),
          focusKey: block.getKey(),
          focusOffset: selection.getEndOffset(), // key of block
          hasFocus: true
        });
        newPages[i].editorState = EditorState.forceSelection(newPages[i].editorState, deselection);
      }
    }
    this.setState({pages: newPages});
  }

  /**
   * parse and react to received websocket messages
   *
   * @param {JSON} message
   */
  processSocketMessage(message) {
    switch (message.command) {
      case 'pushAssociations':
        if (message.data) {
          this.setState({
            associations: message.data
          }, () => {
            this.compositeDecorators = this.createDecorators();
            // I have to obnoxiously trigger a re-render to get new associations to appear
            this.forceRender();
          });
        }
        break;
      case 'newAssociationFailed':
        console.log('failed to make association');
        break;
    }
  }

  /**
   * Retrieve all associations from the API.
   *
   * @return {Promise}
   */
  fetchAssociations() {
    return fetch(Globals.SERVICE_URL + '/story/' + this.storyID + '/associations', {
      headers: Globals.getHeaders()
    }).then((response) => {
      switch (response.status) {
        case 200:
          response.json().then((data) => {
            this.setState({
              associations: data
            }, () => {
              this.compositeDecorators = this.createDecorators();
            });
          });
          break;
      }
    });
  }
  
  redrawAssociations() {
    this.fetchAssociations();
  }

  /**
   * gets all pages for a given document
   *
   * @return {Promise}
   */
  fetchDocumentPages() {
    return fetch(Globals.SERVICE_URL + '/story/' + this.storyID + '/pages', {
      headers: Globals.getHeaders()
    }).then((response) => {
      switch (response.status) {
        case 200:
          response.json().then((data) => {
            const pages = [];
            data.forEach((item) => {
              const contentState = convertFromRaw(item.body);
              const editorState = EditorState.createWithContent(contentState);
              pages.push({'editorState': editorState, 'pageNum': item.page});
              this.setState({
                pages: pages
              });
            });
          });
          break;
        case 404: {
          const blankpages = [];
          blankpages.push({'editorState': EditorState.createEmpty(), 'pageNum': 0});
          this.setState({
            pages: blankpages
          });
          break;
        }
      }
      this.setState({
        loading: false
      });
    }).catch((error) => {
      console.error('Error:', error);
    });
  }

  /**
   * Get the full URL of the websocket from the API
   */
  fetchWebsocketURL() {
    fetch('/wsinit', {
      headers: Globals.getHeaders()
    }).then((response) => response.json()).then((data) => {
      this.setupWebsocket(data.url);
    }).catch((error) => {
      console.error('Error:', error);
    });
  }

  /**
   * Add a new page to the bottom of the document.
   */
  async addNewPage() {
    const pages = this.state.pages;
    const editorState = EditorState.createEmpty();
    pages.push({'editorState': editorState, 'pageNum': pages.length});
    // const removeBlock = pages[pages.length-1].editorState.getCurrentContent();
    // console.log('new page', removeBlock.getBlockMap());
    await this.setState({
      pages: pages
    }, async () => {
      this.pendingEdits[pages.length] = true;
      return;
    });
  }

  /**
   * Get the current block element being selected
   *
   * @return {Node}
   */
  getSelectedBlockElement() {
    const selection = window.getSelection();
    if (selection.rangeCount == 0) {
      return null;
    }
    let node = selection.getRangeAt(0).startContainer;
    do {
      if (node.getAttribute && node.getAttribute('data-block') == 'true') {
        return node;
      }
      node = node.parentNode;
    } while (node !== null);
    return null;
  }

  /**
   * Recount pages and update page numbers
   * This is mostly to occur after page add or delete
   */
  recalcPagination() {
    const newpages = [];
    for (let i=0; i < this.state.pages.length; i++) {
      newpages.push({'editorState': this.state.pages[i].editorState, 'pageNum': i});
    }
    this.setState({
      pages: newpages
    });
  }

  /**
   * Remove a block element from the map, which will
   * remove it from the dom as well.
   *
   * @param {EditorState} editorState
   * @param {string} blockKey
   * @return {EditorState}
   */
  removeBlockFromMap(editorState, blockKey) {
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    if (blockMap.has(blockKey)) {
      const newBlockMap = blockMap.remove(blockKey);
      const newContentState = contentState.merge({
        blockMap: newBlockMap
      });
      return EditorState.push(editorState, newContentState, 'remove-range');
    }
    return editorState;
  }

  /**
   * Check if page's contents exceed maximum height and push it to the subsequent page,
   * creating one if necessary.
   *
   * @param {number} pageNumber
   * @param {boolean} renderedNewPage
   */
  async checkPageHeightAndAdvanceToNextPageIfNeeded(pageNumber, renderedNewPage) {
    const pages = this.state.pages;
    if (!pages[pageNumber] || !this.refHandles[pageNumber]) {
      return;
    }
    const editor = this.refHandles[pageNumber].current;
    const maxHeight = this.state.pageHeight - this.state.topMargin - this.state.bottomMargin;
    const selection = pages[pageNumber].editorState.getSelection();
    if (editor.editorContainer.firstChild.firstChild.offsetHeight > maxHeight) {
      if (!pages[pageNumber+1]) {
        await this.addNewPage();
        return this.checkPageHeightAndAdvanceToNextPageIfNeeded(pageNumber, true);
      }
      const removeBlock = pages[pageNumber].editorState.getCurrentContent().getLastBlock();

      let blockArray = [];
      blockArray.push(removeBlock);
      if (!renderedNewPage) {
        blockArray = blockArray.concat(pages[pageNumber+1].editorState.getCurrentContent().getBlockMap().toArray());
      }
      const combinedContentState = ContentState.createFromBlockArray(blockArray);
      const slicedEditorState = this.removeBlockFromMap(pages[pageNumber].editorState, removeBlock.getKey());
      if (!slicedEditorState) {
        console.log('unable to slice off last block');
        return;
      }
      pages[pageNumber+1].editorState = EditorState.push(pages[pageNumber+1].editorState, combinedContentState);
      pages[pageNumber].editorState = slicedEditorState;
      this.setState({
        pages: pages
      }, () => {
        this.currentPage = this.refHandles.length-1;
        const currentSelectedKey = selection.focusKey;
        if (currentSelectedKey == removeBlock.getKey()) {
          this.setFocus(pageNumber+1);
          const selection = pages[pageNumber].editorState.getSelection();
          pages[pageNumber+1].editorState = EditorState.forceSelection(pages[pageNumber+1].editorState, selection);
          this.setState({
            pages: pages
          });
        }
        return this.checkPageHeightAndAdvanceToNextPageIfNeeded(pageNumber);
      });
    }
  }

  /**
   * Get styles of the preceding block
   *
   * @param {EditorState} editorState
   * @return {boolean}
   */
  getPreviousBlockStyles(editorState) {
    const prevSelection = editorState.getCurrentContent().getSelectionBefore();
    const lastBlock = editorState.getCurrentContent().getBlockForKey(prevSelection.getFocusKey());
    const data = lastBlock.getData();
    const styles = {};
    const alignment = data.getIn(['alignment']);
    styles.direction = alignment;
    const lineHeight = data.getIn(['lineHeight']);
    let height = 'lineheight_single';
    if (lineHeight) {
      height = lineHeight;
    }
    styles.lineHeight = height;
    return styles;
  }

  /**
   * insert a TAB entity
   *
   * @param {EditorState} editorState
   * @return {EditorState}
   */
  insertTab(editorState) {
    const currentContent = editorState.getCurrentContent();
    const selection = editorState.getSelection();
    const contentStateWithEntity = currentContent.createEntity('TAB', 'IMMUTABLE');
    const entityKey = contentStateWithEntity.getLastCreatedEntityKey();
    const textWithEntity = Modifier.insertText(currentContent, selection, '     ', null, entityKey);
    return EditorState.push(editorState, textWithEntity);
  }

  /**
   * Fires on every DraftJS keystroke or cursor change
   *
   * @param {EditorState} editorState
   * @param {number} pageNumber
   */
  onChange(editorState, pageNumber) {
    console.log('change', pageNumber);
    const pagesUpdate = this.state.pages;
    let cursorChange = false;
    const selection = editorState.getSelection();
    // Cursor has moved but no text changes detected.
    if (this.state.pages[pageNumber].editorState.getCurrentContent() === editorState.getCurrentContent()) {
      if (this.rightclickAddMenu.current.IsOpen) {
        // this.rightclickMenu.current.hide();
      }
      if (this.popPanel.current.IsOpen) {
        // this.popPanel.current.hide();
      }
      cursorChange = true;
      const lastBlock = editorState.getCurrentContent().getBlockForKey(selection.getFocusKey());
      this.updateTextControls(lastBlock.getData().getIn(['alignment']));
      const lineHeight = lastBlock.getData().getIn(['lineHeight']);
      this.updateTextControls(lineHeight);
    }

    const dataMap = [];
    const blockTree = this.state.pages[pageNumber].editorState.getBlockTree(selection.getFocusKey());
    if (!blockTree) {
      // a new block has been added, copy styles from previous block
      const styles = this.getPreviousBlockStyles(editorState);
      dataMap.push(['alignment', styles.direction]);
      dataMap.push(['lineHeight', styles.lineHeight]);
      const iMap = Immutable.Map(dataMap);
      const nextContentState = Modifier.mergeBlockData(editorState.getCurrentContent(), selection, iMap);
      editorState = EditorState.push(editorState, nextContentState, 'change-block-data');

      // auto tab if align left
      if (styles.direction == 'left') {
        editorState = this.insertTab(editorState);
      }
    }
    pagesUpdate[pageNumber].editorState = editorState;
    this.setState({
      pages: pagesUpdate
    }, async () => {
      if (this.deletePressed) {
        this.deletePressed = false;
        console.log('delpressed');
        const selection = editorState.getSelection();
        const blockKey = selection.getFocusKey();
        const block = editorState.getCurrentContent().getBlockForKey(blockKey);
        const firstKey = editorState.getCurrentContent().getFirstBlock().getKey();

        if (!editorState.getCurrentContent().hasText() && pagesUpdate.length > 1) {
          this.setFocus(pageNumber-1);
          console.log('deleting empty page');
          pagesUpdate.splice(pageNumber, 1);
          this.refHandles.splice(pageNumber, 1);
          this.recalcPagination();
          this.deletePage(pageNumber);
          this.currentPage--;
          pagesUpdate[pageNumber-1].editorState = EditorState.moveFocusToEnd(pagesUpdate[pageNumber-1].editorState);
          this.setState({
            pages: pagesUpdate
          }, () => {
            // this.scrollToBlock();
          });
        } else if (!block.getText().length && pagesUpdate.length > 1) {
          console.log('deleting empty block');
          pagesUpdate[pageNumber].editorState = this.removeBlockFromMap(editorState, blockKey);
          this.setState({pages: pagesUpdate});
        } else if (block.getText().length && blockKey == firstKey && pageNumber > 0) {
          console.log('text present del', block.getText());
          // we are on the first line of the page and text is present
          if (!selection.getFocusOffset() && !selection.getAnchorOffset()) {
            // cursor is at the start of the line
            const blockText = block.getText();
            pagesUpdate[pageNumber].editorState = this.removeBlockFromMap(editorState, blockKey);
            this.setState({pages: pagesUpdate}, () => {
              const prevPageLastBlock = pagesUpdate[pageNumber-1].editorState.getCurrentContent().getLastBlock();
              const prevSelection = new SelectionState({
                anchorKey: prevPageLastBlock.getKey(), // key of block
                anchorOffset: prevPageLastBlock.getText().length,
                focusKey: prevPageLastBlock.getKey(),
                focusOffset: prevPageLastBlock.getText().length, // key of block
                hasFocus: true
              });
              const ncs = Modifier.insertText(pagesUpdate[pageNumber-1].editorState.getCurrentContent(), prevSelection, blockText);
              pagesUpdate[pageNumber-1].editorState = EditorState.push(pagesUpdate[pageNumber-1].editorState, ncs, 'insert-fragment');
              pagesUpdate[pageNumber-1].editorState = EditorState.forceSelection(pagesUpdate[pageNumber-1].editorState, prevSelection);
              this.currentPage--;
              this.setState({pages: pagesUpdate});
            });
          }
        }
        this.pendingEdits.set(pageNumber, true);
        return;
      }
      if (!cursorChange) {
        await this.checkPageHeightAndAdvanceToNextPageIfNeeded(pageNumber);
        this.pendingEdits.set(pageNumber, true);
      }
    });
  }

  /**
   * Scroll to the currently selected block element
   */
  scrollToBlock() {
    const blockDOM = this.getSelectedBlockElement();
    if (blockDOM) {
      const domY = blockDOM.getBoundingClientRect().top;
      if (Math.abs(domY - window.scrollY) > 400) {
        const scrollToY = blockDOM.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({top: scrollToY-100, behavior: 'smooth'});
      }
    }
  }

  /**
   * Check stored action arrays for upcoming writes
   */
  checkForPendingEdits() {
    this.pendingEdits.forEach((value, key) => {
      if (value) {
        this.savePage(key);
        this.pendingEdits.set(key, false);
      }
    });
  }

  /**
   * Send command via websocket save specific page
   *
   * @param {number} pageNumber
   */
  savePage(pageNumber) {
    console.log('saving page ' + pageNumber);
    // Send the encoded page if the socket is open and it hasn't been subsequently deleted
    if (this.socket.isOpen && this.state.pages[pageNumber]) {
      this.socket.send(JSON.stringify({command: 'savePage', data: {page: pageNumber, storyID: this.storyID, body: convertToRaw(this.state.pages[pageNumber].editorState.getCurrentContent())}}));
    }
  }

  /**
   * Send command via websocket to save all pages
   */
  saveAllPages() {
    for (let i=0; i < this.state.pages.length; i++) {
      this.savePage(i);
    }
  }

  /**
   * Send command via websocket to delete given page
   *
   * @param {number} pageNumber
   */
  deletePage(pageNumber) {
    console.log('deleting page', pageNumber);
    if (this.socket.isOpen) {
      this.socket.send(JSON.stringify({command: 'deletePage', data: {page: pageNumber, storyID: this.storyID}}));
    }
  }

  /**
   * Get user's resolution based on device DPI
   *
   * @return {number} resolution
   */
  getDPI() {
    let i=56;
    for (i = 56; i < 2000; i++) {
      if (matchMedia('(max-resolution: ' + i + 'dpi)').matches === true) {
        return i;
      }
    }
    return i;
  }

  /**
   * return a string for specific key presses or combinations
   *
   * @param {event} event
   * @return {string}
   */
  keyBindings(event) {
    // tab pressed
    if (event.keyCode == 9) {
      event.preventDefault();
      const pagesUpdate = this.state.pages;
      pagesUpdate[this.currentPage].editorState = this.insertTab(pagesUpdate[this.currentPage].editorState);
      this.setState({pages: pagesUpdate});
    }
    if (event.ctrlKey) {
      if (event.keyCode == 83) {
        return 'ctrl_s';
      }
      if (event.keyCode == 190) {
        return 'ctrl_>';
      }
      if (event.keyCode == 188) {
        return 'ctrl_<';
      }
    }
    return getDefaultKeyBinding(event);
  }

  /**
   * Calls for specific keypresses
   *
   * @param {string} command
   * @param {number} pageNumber
   */
  handleKeyCommand(command, pageNumber) {
    console.log('cmd', command, 'page', pageNumber);
    switch (command.toLowerCase()) {
      case 'delete':
      case 'backspace': {
        console.log('hit delete');
        this.deletePressed = true;
        this.onChange(this.state.pages[pageNumber].editorState, pageNumber);
        break;
      }
      case 'bold':
      case 'italic':
      case 'underline': {
        const pagesUpdate = this.state.pages;
        pagesUpdate[this.currentPage].editorState = RichUtils.toggleInlineStyle(pagesUpdate[this.currentPage].editorState, command.toUpperCase());
        this.setState({
          pages: pagesUpdate,
        });
        break;
      }
    }
  }

  /**
   * Set focus to passed Draft element
   * @param {number} index
   */
  setFocus(index) {
    // console.log('focus on', index);
    this.currentPage = index;
    this.refHandles[index].current.focus();
    if (this.rightclickAddMenu.current.IsOpen) {
      this.rightclickAddMenu.current.hide();
    }
    if (this.rightclickEditMenu.current.IsOpen) {
      this.rightclickEditMenu.current.hide();
    }
    if (this.popPanel.current.IsOpen) {
      this.popPanel.current.hide();
    }
  }

  /**
   * Toggle states of text controls based on current block style
   * @param {string} style
   */
  updateTextControls(style) {
    if (lineSpacings.has(style)) {
      this.setState({
        currentLineHeight: style
      });
      return;
    }

    let l=true;
    let c=false;
    let r=false;
    let j=false;
    switch (style) {
      case 'center':
        l = false;
        c = true;
        r = false;
        j = false;
        break;
      case 'right':
        l = false;
        c = false;
        j = false;
        r = true;
        break;
      case 'justify':
        l = false;
        r = false;
        c = false;
        j = true;
        break;
    }
    this.setState({
      leftOn: l,
      centerOn: c,
      rightOn: r,
      justifyOn: j
    });
  }

  /**
   * get block css styles from block metadata
   *
   * @param {Block} contentBlock
   * @return {string} classStr
   */
  generateBlockStyle(contentBlock) {
    let classStr = '';
    const data = contentBlock.getData();
    const alignment = data.getIn(['alignment']);
    if (alignment) {
      classStr += 'align_' + data.getIn(['alignment']);
    }
    const lineHeight = data.getIn(['lineHeight']);
    if (lineHeight) {
      if (classStr.length) {
        classStr += ' ';
      }
      classStr += lineHeight;
    }
    return classStr;
  }

  /**
   * Update the current block's alignment based on button click
   *
   * @param {string} style
   * @param {event} event
   */
  updateTextAlignment(style, event) {
    event.preventDefault();
    const pagesUpdate = this.state.pages;
    const selection = pagesUpdate[this.currentPage].editorState.getSelection();
    const nextContentState = Modifier.mergeBlockData(pagesUpdate[this.currentPage].editorState.getCurrentContent(), selection, Immutable.Map([['alignment', style]]));
    pagesUpdate[this.currentPage].editorState = EditorState.push(pagesUpdate[this.currentPage].editorState, nextContentState, 'change-block-data');
    this.updateTextControls(style);
    this.setState({
      pages: pagesUpdate
    }, () => {
      this.pendingEdits.set(this.currentPage, true);
    });
  }

  /**
   * Update the current block's line-height based on button click
   *
   * @param {event} event
   */
  updateLineHeight(event) {
    event.preventDefault();
    const clicked = event.target.dataset.height;
    let nextSpacing = 'lineheight_single';
    let prevMatch = false;
    let key;
    for ([key] of lineSpacings) {
      if (key == clicked) {
        prevMatch = true;
        continue;
      }
      if (prevMatch) {
        nextSpacing = key;
        break;
      }
    }
    const pagesUpdate = this.state.pages;
    const selection = pagesUpdate[this.currentPage].editorState.getSelection();
    pagesUpdate[this.currentPage].editorState = EditorState.forceSelection(this.state.pages[this.currentPage].editorState, selection);
    const nextContentState = Modifier.mergeBlockData(pagesUpdate[this.currentPage].editorState.getCurrentContent(), selection, Immutable.Map([['lineHeight', nextSpacing]]));
    pagesUpdate[this.currentPage].editorState = EditorState.push(pagesUpdate[this.currentPage].editorState, nextContentState, 'change-block-data');
    this.setState({
      pages: pagesUpdate,
      currentLineHeight: nextSpacing
    }, () => {
      this.pendingEdits.set(this.currentPage, true);
    });
  }

  /**
   * Handler for right-click event
   *
   * @param {Number} page
   * @param {Event} event
  **/
  onRightClick(page, event) {
    const text = this.getSelectedText(this.state.pages[page].editorState);
    if (text.length) {
      event.preventDefault();
      this.setState({selectedText: text});
      this.rightclickAddMenu.current.updateAndDisplay(event.pageX, event.pageY);
    }
  }

  /**
   * Get the current selected (highlighted) text
   *
   * @param {Object} editorState
   * @return {String} selectedText
  **/
  getSelectedText(editorState) {
    const selection = editorState.getSelection();
    const anchorKey = selection.getAnchorKey();
    const currentContent = editorState.getCurrentContent();
    const currentBlock = currentContent.getBlockForKey(anchorKey);

    const start = selection.getStartOffset();
    const end = selection.getEndOffset();
    const selectedText = currentBlock.getText().slice(start, end);
    return selectedText;
  }

  /**
   * render
   * @return {element}
  **/
  render() {
    const editors = [];
    for (let i=0; i < this.state.pages.length; i++) {
      this.refHandles.push(React.createRef());
      editors.push(
          <section key={i} onContextMenu={(e)=> {this.onRightClick(i, e);}} onClick={() => {this.setFocus(i);}} className="margins" style={{maxHeight: this.state.pageHeight, height: this.state.pageHeight, paddingLeft: this.state.leftMargin, paddingRight: this.state.rightMargin, paddingTop: this.state.topMargin, paddingBottom: this.state.bottomMargin}}>
            <Editor
              editorState={this.state.pages[i].editorState}
              handleKeyCommand={(command) => {
                this.handleKeyCommand(command, i);
              }}
              keyBindingFn={this.keyBindings.bind(this)}
              placeholder="Write something..."
              blockStyleFn={this.generateBlockStyle.bind(this)}
              onChange={(editorState) => {
                this.onChange(editorState, i);
              }}
              ref={this.refHandles[i]}/>
          </section>
      );
      this.state.pages[i].editorState = EditorState.set(this.state.pages[i].editorState, {decorator: this.compositeDecorators});
    }
    if (this.state.loading) {
      return (<div>loading...</div>);
    } else {
      console.log('rendering for ' + this.state.pages.length);
      return (
        <div style={{'position': 'relative'}}>
          <nav className="docControls">
            <ul style={{width: this.state.pageWidth}}>
              <li><FormatAlignLeftIcon fontSize="inherit" className={this.state.leftOn ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={(e) => this.updateTextAlignment('left', e)}/></li>
              <li><FormatAlignCenterIcon fontSize="inherit" className={this.state.centerOn ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={(e) => this.updateTextAlignment('center', e)}/></li>
              <li><FormatAlignRightIcon fontSize="inherit" className={this.state.rightOn ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={(e) => this.updateTextAlignment('right', e)}/></li>
              <li><FormatAlignJustifyIcon fontSize="inherit" className={this.state.justifyOn ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={(e) => this.updateTextAlignment('justify', e)} /></li>
              <li style={{'paddingTop': '2px'}}>
                <span>
                  <FormatLineSpacingIcon data-height={this.state.currentLineHeight} fontSize="inherit" onMouseDown={(e) => e.preventDefault()} onClick={(e) => this.updateLineHeight(e)}/>
                  <span>{lineSpacings.get(this.state.currentLineHeight)}</span>
                </span>
              </li>
            </ul>
          </nav>
          <div className="editorRoot" style={{width: this.state.pageWidth}}>
            <div onClick={this.focus} className="editorContainer">
              {editors}
            </div>
          </div>
          <CustomContext ref={this.rightclickAddMenu} type="add" items={JSON.stringify(addMenu)} selected={this.state.selectedText} socket={this.socket} storyID={this.storyID}/>
          <CustomContext ref={this.rightclickEditMenu} type="edit" items={JSON.stringify(editMenu)} editingID={this.state.selectedAssociation} socket={this.socket} storyID={this.storyID}/>
          <PopPanel ref={this.popPanel} label="" storyID={this.storyID} onUpdateAssociationComplete={this.redrawAssociations.bind(this)}/>
        </div>
      );
    }
  }
}

const CharacterSpan = (props) => {
  return (
    <span onClick={(e)=> {props.leftclickFunc(props.decoratedText);}} onContextMenu={(e)=> {props.rightclickFunc(e, props.decoratedText);}} className="highlight character">
      {props.children}
    </span>
  );
};

const PlaceSpan = (props) => {
  return (
    <span onClick={(e)=> {props.leftclickFunc(props.decoratedText);}} onContextMenu={(e)=> {props.rightclickFunc(e, props.decoratedText);}} className="highlight place">
      {props.children}
    </span>
  );
};

const EventSpan = (props) => {
  return (
    <span onClick={(e)=> {props.leftclickFunc(props.decoratedText);}} onContextMenu={(e)=> {props.rightclickFunc(e, props.decoratedText);}} className="highlight event">
      {props.children}
    </span>
  );
};

CharacterSpan.propTypes = PlaceSpan.propTypes = EventSpan.propTypes = {
  leftclickFunc: PropTypes.func,
  rightclickFunc: PropTypes.func,
  decoratedText: PropTypes.string,
  children: PropTypes.array
};
