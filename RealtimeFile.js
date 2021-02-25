const { v4: uuidv4 } = require("uuid");
const { type: jot } = require("ot-json0");

module.exports = class RealtimeFile {
  constructor(fileName, base, sockets, fileChangeCallback) {
    this.fileName = fileName;
    this.sockets = sockets;
    this.fileChangeCallback = fileChangeCallback;
    this.committedFile = JSON.parse(JSON.stringify(base));
    this.committedOpIndex = -1;
    this.outstandingMessageUid = "";
    this.outstandingOp = null;
    this.outstandingOpSuccess = false;
    this.localOpBuffer = null;
    this.remoteOpBuffer = null;
    this.remoteIndexBuffer = -1;
    this.closed = false;
  }

  fetchRemoteCommits() {
    this.sendMessage({
      uid: uuidv4(),
      endpoint: "FILE_RETRIEVE",
      file: this.fileName,
      fileState: JSON.stringify(this.committedFile), // used as a base if the file has no other operations.
    });
  }

  changeResolver() {
    if (this.outstandingMessageUid === "") {
      let committedFileChanged = false;
      let displayFileState;
      let displayFileStatePending = false;
      if (this.outstandingOp != null && !this.outstandingOpSuccess) {
        if (this.localOpBuffer)
          this.localOpBuffer = jot.compose(
            this.outstandingOp,
            this.localOpBuffer
          );
        else this.localOpBuffer = this.outstandingOp;
        this.outstandingOp = null;
      }
      if (this.localOpBuffer != null && this.remoteOpBuffer != null) {
        console.log("local op before rebase");
        console.log(this.localOpBuffer);
        this.localOpBuffer = jot.transform(
          this.localOpBuffer,
          this.remoteOpBuffer,
          "right"
        );
        console.log("local op after rebase");
        if (this.localOpBuffer) console.log(this.localOpBuffer);
        else console.log("null");
      }
      if (this.outstandingOpSuccess) {
        console.log(
          "commit self op: " +
            (this.committedOpIndex + 1) +
            " - " +
            this.remoteIndexBuffer
        );
        console.log("self op");
        console.log(this.outstandingOp);
        console.log("committed file before self op apply");
        console.log(JSON.stringify(this.committedFile));
        this.committedFile = jot.apply(
          jot.create(this.committedFile),
          this.outstandingOp
        );
        console.log("committed file after self op apply");
        console.log(JSON.stringify(this.committedFile));
        this.committedOpIndex = this.remoteIndexBuffer;
        this.outstandingOp = null;
        this.outstandingOpSuccess = false;
        committedFileChanged = true;
      }
      if (this.remoteOpBuffer) {
        console.log(
          "commit remote op: " +
            (this.committedOpIndex + 1) +
            " - " +
            this.remoteIndexBuffer
        );
        console.log("remote op");
        console.log(this.remoteOpBuffer);
        console.log("committed file before apply remote");
        console.log(JSON.stringify(this.committedFile));
        this.committedFile = jot.apply(
          jot.create(this.committedFile),
          this.remoteOpBuffer
        );
        console.log("committed file after apply remote");
        console.log(JSON.stringify(this.committedFile));
        this.committedOpIndex = this.remoteIndexBuffer;
        this.remoteOpBuffer = null;
        committedFileChanged = true;
      }
      if (this.localOpBuffer) {
        console.log("send local op with index " + (this.committedOpIndex + 1));
        console.log(this.localOpBuffer);
        console.log("committed file state before local apply");
        console.log(JSON.stringify(this.committedFile));
        displayFileState = jot.apply(
          jot.create(this.committedFile),
          this.localOpBuffer
        );
        console.log("display file state after local apply");
        console.log(displayFileState);
        console.log("committed file state after local apply");
        console.log(JSON.stringify(this.committedFile));
        displayFileStatePending = true;
        this.sendLocalOpBuffer();
      } else if (committedFileChanged) {
        displayFileState = jot.create(this.committedFile);
        displayFileStatePending = true;
      }
      if (displayFileStatePending) this.fileChangeCallback(displayFileState);
    }
  }

  handleRemoteCommits(message) {
    console.log("received remote op - length: " + message.operations.length);
    let remoteOp = this.mergeRemoteOperations(
      message.index,
      message.operations
    );
    if (remoteOp != null) {
      if (this.remoteOpBuffer)
        this.remoteOpBuffer = jot.compose(this.remoteOpBuffer, remoteOp);
      else this.remoteOpBuffer = remoteOp;
    }
    this.remoteIndexBuffer = message.operations.length + message.index - 1;
  }

  handleSelfCommits(message) {
    console.log("received self op - length: " + message.operations.length);
    this.outstandingOpSuccess = true;
    this.remoteIndexBuffer = message.operations.length + message.index - 1;
  }

  handleInitialFile(message) {
    // I feel that we shouldn't be discarding messages that don't match and instead stick them in a queue
    // until they're ready to be handled.
    const msg = this.checkAgainstOutstandingMessage(message);
    if (!msg) {
      console.error(
        `Received message out of order (message uid doesn't match): ${message}`
      );
      return;
    }

    let base;
    if (msg.fileState) {
      base = JSON.parse(msg.fileState);
    } else {
      // When the notebook file was created, whatever the default notebook is will be set to this.committedFile.
      // In the case of Jupyterlab, this will be a notebook with a single blank code cell.
      base = this.committedFile;
    }
    base = jot.create(base);

    const mergedOps = this.mergeOperations(msg.operations);
    // Overrides any existing committedFile
    if (mergedOps) {
      this.committedFile = jot.apply(base, mergedOps);
    } else {
      this.committedFile = base;
    }

    this.remoteIndexBuffer = msg.operations.length + msg.index;
    this.committedOpIndex = this.remoteIndexBuffer;

    this.fileChangeCallback(this.committedFile);
  }

  mergeOperations(operations) {
    let op = null;
    for (let i = 0; i < operations.length; i++) {
      if (op) op = jot.compose(op, JSON.parse(operations[i]));
      else op = JSON.parse(operations[i]);
    }

    return op;
  }

  mergeRemoteOperations(remoteIndex, operations) {
    let start;
    if (operations) {
      start = this.remoteIndexBuffer - remoteIndex + 1;
      if (start < 0) return null;
      return this.mergeOperations(operations.slice(start));
    }
    return null;
  }

  sendMessage(message) {
    if (this.outstandingMessageUid !== "") {
      console.error("only one outstanding message can be sent at a time");
      return;
    }
    if (this.sockets[0].readyState !== this.sockets[0].OPEN) {
      console.error("try to send message when socket is not open");
      return;
    }
    this.outstandingMessageUid = message.uid;
    this.sockets[0].send(JSON.stringify(message));
    console.log("---sent message---");
  }

  checkAgainstOutstandingMessage(message) {
    console.log("---received message---");
    if (message.file !== this.fileName) {
      console.error(
        "received file name: " +
          message.file +
          " does not match the file: " +
          this.fileName
      );
      return null;
    }
    if (message.uid === this.outstandingMessageUid) {
      console.log("outstanding message cleared");
      this.outstandingMessageUid = "";
      message.resp = true;
    }
    return message;
  }

  receiveMessage(message) {
    message = this.checkAgainstOutstandingMessage(message);
    if (!message) return;
    console.log(message.status);
    console.log("message index: " + message.index);
    if (message.index - this.remoteIndexBuffer > 1) {
      console.error(
        "index mismatch, remote index: " +
          message.index +
          " local index: " +
          this.remoteIndexBuffer
      );
    }
    if (message.status === "OP_COMMITTED") {
      if (message.index - this.remoteIndexBuffer !== 1) {
        console.error(
          "OP can only be committed in continuous sequence remote index: " +
            message.index +
            " local index: " +
            this.remoteIndexBuffer
        );
        console.error(message);
      } else {
        if (message.resp) this.handleSelfCommits(message);
        else this.handleRemoteCommits(message);
      }
    } else if (message.status === "OP_TOO_OLD")
      this.handleRemoteCommits(message);
    else if (message.status === "FILE_DOESNT_EXIST") {
      const createFileMessage = {
        uid: uuidv4(),
        endPoint: "FILE_CREATE",
        file: this.fileName,
      };
      this.sendMessage(createFileMessage);
    } else {
      console.error("wrong file update return status: " + message.status);
      console.error(message);
    }
  }

  sendLocalOpBuffer() {
    this.sendMessage({
      uid: uuidv4(),
      endpoint: "FILE_UPDATE",
      file: this.fileName,
      index: this.committedOpIndex + 1,
      operations: [JSON.stringify(this.localOpBuffer)],
    });
    this.outstandingOp = JSON.parse(JSON.stringify(this.localOpBuffer));
    this.localOpBuffer = null;
  }

  handleLocalChange(localOp) {
    if (localOp) {
      if (this.localOpBuffer)
        this.localOpBuffer = jot.compose(this.localOpBuffer, localOp);
      else this.localOpBuffer = localOp;
    }
  }

  close() {
    this.closed = true;
  }
};
