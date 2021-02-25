const { v4: uuidv4 } = require("uuid");
const RealtimeFile = require("./RealtimeFile");

const websocketAddr = "wss://api.syncpoint.xyz";

const endpointPassthrough = "PASSTHROUGH";
const endpointFileUpdate = "FILE_UPDATE";
const endpointFileCreate = "FILE_CREATE";
const endpointFileRename = "FILE_RENAME";
const endpointFileDelete = "FILE_DELETE";
const endpointModifyUser = "MODIFY_USER";
const endpointListUsers = "LIST_USERS";
const endpointListFiles = "LIST_FILES";
const endpointListHub = "LIST_HUB";
const endpointConnectToHub = "CONNECT_HUB";
const endpointDisconnectFromHub = "DISCONNECT_HUB";
const endpointHubCreate = "HUB_CREATE";
const endpointFileRetrieve = "FILE_RETRIEVE";

const addUser = "ADD";
const removeUser = "REMOVE";

class HubConnector {
  constructor() {
    this.files = {};
    this.intervalID = 0;
    this.sockets = [null];
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

  hasFile(fileName) {
    if (!this.files.hasOwnProperty(fileName)) return false;
    if (this.files[fileName]._file.closed) {
      delete this.files[fileName];
      return false;
    }
    return true;
  }

  onFileChange(fileName, base, fileChangeCallback) {
    // We don't connect to sockets within a file; explicitly connect to the backend first.
    if (!this.sockets[0]) return null;
    let fileListener = new FileListener(
      fileName,
      base,
      this.sockets,
      fileChangeCallback
    );
    return this.onFileChangeBase(fileName, fileListener);
  }

  onNotebookChange(fileName, base, fileChangeCallback) {
    // We don't connect to sockets within a file; explicitly connect to the backend first.
    if (!this.sockets[0]) return null;
    let notebookListener = new NotebookListener(
      fileName,
      base,
      this.sockets,
      fileChangeCallback
    );
    return this.onFileChangeBase(fileName, notebookListener);
  }

  onFileChangeBase(fileName, fileListener) {
    if (this.hasFile(fileName)) return this.files[fileName];
    if (!this.sockets[0]) {
      this.files[fileName] = fileListener;
      this.connectSocket();
    } else {
      this.files[fileName] = fileListener;
      if (this.sockets[0].readyState === this.sockets[0].OPEN)
        fileListener._file.fetchRemoteCommits();
    }
    return fileListener;
  }

  connectSocket(newReceiver) {
    if (this._interval && this._user) {
      this.sockets[0] = new WebSocket(websocketAddr, this._user);
      this.sockets[0].onmessage = (event) => {
        let message = JSON.parse(event.data);
        if (message.endpoint === endpointFileUpdate) {
          if (this.hasFile(message.file))
            this.files[message.file]._file.receiveMessage(message);
          return;
        }
        if (message.endpoint === endpointFileRetrieve) {
          if (this.hasFile(message.file)) {
            this.files[message.file]._file.handleInitialFile(message);
          }
          return;
        }
        if (!newReceiver) {
          console.log(
            "received hub update message but no handler to process it"
          );
          return;
        }
        if (message.endpoint === endpointListUsers) {
          newReceiver({
            messageType: endpointListUsers,
            status: message.status,
            users: message.userList,
          });
        } else if (message.endpoint === endpointListFiles) {
          newReceiver({
            messageType: endpointListFiles,
            status: message.status,
            files: message.fileList,
          });
        } else if (message.endpoint === endpointFileCreate) {
          newReceiver({
            messageType: endpointFileCreate,
            status: message.status,
            file: { name: message.file },
          });
        } else if (message.endpoint === endpointFileRename) {
          newReceiver({
            messageType: endpointFileRename,
            status: message.status,
            file: { name: message.file },
          });
        } else if (message.endpoint === endpointFileDelete) {
          newReceiver({
            messageType: endpointFileDelete,
            status: message.status,
          });
        } else if (message.endpoint === endpointListHub) {
          newReceiver({
            messageType: endpointListHub,
            status: message.status,
            hubList: message.hubList,
          });
        } else if (message.endpoint === endpointConnectToHub) {
          newReceiver({
            messageType: endpointConnectToHub,
            status: message.status,
            hubName: message.hubName,
          });
        } else {
          console.log(
            "Received hub update with unhandled endpoint: " + message.endpoint
          );
        }
      };
      this.sockets[0].onopen = (event) => {
        console.log("websocket connected!");
        for (let [fileName, listener] of Object.entries(this.files)) {
          if (!this.hasFile(fileName)) continue;
          listener._file.fetchRemoteCommits();
        }
        this.intervalID = setInterval(() => {
          console.log("---interval triggered---");
          for (let [fileName, listener] of Object.entries(this.files)) {
            if (!this.hasFile(fileName)) continue;
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
        "please set interval, and user before trigger onFileChange"
      );
  }

  createHub() {
    const message = {
      uid: uuidv4(),
      endPoint: endpointHubCreate,
    };
    this.sendMessage(message);
  }

  connectToHub(hub) {
    const message = {
      uid: uuidv4(),
      endPoint: endpointConnectToHub,
      hubName: hub,
    };
    this.sendMessage(message);
  }

  disconnectFromHub() {
    const message = {
      uid: uuidv4(),
      endPoint: endpointDisconnectFromHub,
    };
    this.sendMessage(message);
  }

  requestHubList() {
    const message = {
      uid: uuidv4(),
      endPoint: endpointListHub,
    };
    this.sendMessage(message);
  }

  requestFileList() {
    const message = {
      uid: uuidv4(),
      endPoint: endpointListFiles,
    };
    return this.sendMessage(message);
  }

  requestNewUntitledFile(fileName) {
    const message = {
      uid: uuidv4(),
      file: fileName,
      endPoint: endpointFileCreate,
    };
    this.sendMessage(message);
  }

  requestFileRename(oldFileName, newFileName) {
    const message = {
      uid: uuidv4(),
      file: oldFileName,
      newFileName: newFileName,
      endPoint: endpointFileRename,
    };
    this.sendMessage(message);
  }

  requestFileDelete(fileName) {
    const message = {
      uid: uuidv4(),
      file: fileName,
      endPoint: endpointFileDelete,
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
    if (
      !this.sockets[0] ||
      this.sockets[0].readyState !== this.sockets[0].OPEN
    ) {
      console.error("try to send message when socket is not open");
      return false;
    }

    this.sockets[0].send(JSON.stringify(message));
    console.log("---sent hub message---");
    return true;
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
    this._file.close();
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
