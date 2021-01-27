const { v4: uuidv4 } = require("uuid");
const RealtimeFile = require("./RealtimeFile");

const websocketAddr = "wss://api.syncpoint.xyz?hub=";

const endpointPassthrough = "PASSTHROUGH";
const endpointFileUpdate = "FILE_UPDATE";
const endpointFileCreate = "FILE_CREATE";
const endpointModifyUser = "MODIFY_USER";
const endpointListUsers = "LIST_USERS";
const endpointListFiles = "LIST_FILES";

const addUser = "ADD";
const removeUser = "REMOVE";

class HubConnector {
  constructor() {
    this.files = {};
    this.intervalID = 0;
    this.sockets = [null];
  }

  hub(newHub) {
    this._hub = newHub;
    return this;
  }

  interval(newInterval) {
    this._interval = newInterval;
    return this;
  }

  user(newUser) {
    this._user = newUser;
    return this;
  }

  hubMessageReceiver(newReceiver) {
    this._hubMessageReceiver = newReceiver;
    return this;
  }

  onFileChange(fileName, base, fileChangeCallback) {
    let fileListener = new FileListener(
      fileName,
      base,
      this.sockets,
      fileChangeCallback
    );
    this.onFileChangeBase(fileName, fileListener);
    return fileListener;
  }

  onNotebookChange(fileName, base, fileChangeCallback) {
    let notebookListener = new NotebookListener(
      fileName,
      base,
      this.sockets,
      fileChangeCallback
    );
    this.onFileChangeBase(fileName, notebookListener);
    return notebookListener;
  }

  onFileChangeBase(fileName, fileListener) {
    if (this.files.hasOwnProperty(fileName)) return this.files[fileName];
    if (!this.sockets[0]) {
      this.files[fileName] = fileListener;
      this.connectSocket();
    } else {
      this.files[fileName] = fileListener;
      if (this.sockets[0].readyState === this.sockets[0].OPEN)
        fileListener._file.fetchRemoteCommits();
    }
  }

  connectSocket(newReceiver) {
    if (this._hub && this._interval && this._user) {
      this.sockets[0] = new WebSocket(websocketAddr + this._hub, this._user);
      this.sockets[0].onmessage = (event) => {
        let message = JSON.parse(event.data);
        if (message.endpoint === endpointFileUpdate) {
          if (this.files.hasOwnProperty(message.file))
            this.files[message.file]._file.receiveMessage(message);
        } else if (message.endpoint === endpointListUsers && newReceiver) {
          console.log("received hub update message");
          newReceiver({
            messageType: endpointListUsers,
            users: message.userList,
          });
        }
      };
      this.sockets[0].onopen = (event) => {
        console.log("websocket connected!");
        for (let [_, listener] of Object.entries(this.files)) {
          listener._file.fetchRemoteCommits();
        }
        this.intervalID = setInterval(() => {
          console.log("---interval triggered---");
          for (let [_, listener] of Object.entries(this.files)) {
            listener._file.changeResolver();
          }
        }, this._interval);
      };
      this.sockets[0].onclose = (event) => {
        console.log("websocket closed");
        clearInterval(this.intervalID);
      };
    } else
      throw new Error(
        "please set hub, interval, and user before trigger onFileChange"
      );
  }

  requestFileList() {
    const message = {
      uid: uuidv4(),
      endPoint: endpointListFiles,
    };
    this.sendMessage(message);
  }

  requestAddUser(identifier) {
    const message = {
      uid: uuidv4(),
      endPoint: endpointModifyUser,
      modifyUserType: addUser,
      modifyUserID: identifier,
    };
    this.sendMessage(message);
  }

  requestRemoveUser(identifier) {
    const message = {
      uid: uuidv4(),
      endPoint: endpointModifyUser,
      modifyUserType: removeUser,
      modifyUserID: identifier,
    };
    this.sendMessage(message);
  }

  requestModifyUserRole(identifier, newRole) {
    const message = {
      uid: uuidv4(),
      endPoint: endpointModifyUser,
      modifyUserType: modifyUser,
      modifyUserID: identifier,
      modifyUserRole: newRole,
    };
    this.sendMessage(message);
  }

  sendMessage(message) {
    if (this.sockets[0].readyState !== this.sockets[0].OPEN) {
      console.error("try to send message when socket is not open");
      return;
    }

    this.sockets[0].send(JSON.stringify(message));
    console.log("---sent hub message---");
  }

  close() {
    if (this.sockets[0]) this.sockets[0].close();
    this._hubMessageReceiver = null;
    this.sockets[0] = null;
  }
}

let rtc = new HubConnector();
module.exports.rtc = rtc;

class FileListenerBase {
  constructor(fileName, base, sockets, fileChangeCallback) {
    this._file = new RealtimeFile(fileName, base, sockets, fileChangeCallback);
  }

  unsubscribe() {
    delete files[this._file.fileName];
  }
}

class FileListener extends FileListenerBase {
  constructor(fileName, base, sockets, fileChangeCallback) {
    super(fileName, base, sockets, fileChangeCallback);
  }

  insertText(path, text) {
    this._file.handleLocalChange([{ p: path, si: text }]);
  }

  removeText(path, text) {
    this._file.handleLocalChange([{ p: path, sd: text }]);
  }
}

class NotebookListener extends FileListenerBase {
  constructor(fileName, base, sockets, fileChangeCallback) {
    super(fileName, base, sockets, fileChangeCallback);
  }

  insertText(cell, pos, text, key) {
    key = key || "source";
    this._file.handleLocalChange([{ p: ["cells", cell, key, pos], si: text }]);
  }

  removeText(cell, pos, text, key) {
    key = key || "source";
    this._file.handleLocalChange([{ p: ["cells", cell, key, pos], sd: text }]);
  }

  insertCell(index, newCell) {
    this._file.handleLocalChange([
      { p: ["cells", index], li: JSON.parse(JSON.stringify(newCell)) },
    ]);
  }

  removeCell(index, oldCell) {
    this._file.handleLocalChange([
      { p: ["cells", index], ld: JSON.parse(JSON.stringify(oldCell)) },
    ]);
  }

  moveCell(oldIndex, newIndex) {
    this._file.handleLocalChange([{ p: ["cells", oldIndex], lm: newIndex }]);
  }

  insertObject(cell, key, object) {
    this._file.handleLocalChange([
      { p: ["cells", cell, key], oi: JSON.parse(JSON.stringify(object)) },
    ]);
  }

  removeObject(cell, key, object) {
    this._file.handleLocalChange([
      { p: ["cells", cell, key], od: JSON.parse(JSON.stringify(object)) },
    ]);
  }

  replaceObject(cell, key, oldObject, newObject) {
    const oldObj = JSON.parse(JSON.stringify(oldObject));
    const newObj = JSON.parse(JSON.stringify(newObject));
    this._file.handleLocalChange([
      { p: ["cells", cell, key], od: oldObj, oi: newObj },
    ]);
  }
}
