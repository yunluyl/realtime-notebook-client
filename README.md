Web UI can use this client to sync realtime Jupyter notebook changes.

### Mechanism
This client connects to the hosted backend using Websocket protocol and automatically syncs realtime edits from multiple users in a Jupyter notebook.

### Use this package
Install
```bash
yarn add realtime-notebook-client
```
Use
```js
import { rtc } from 'realtime-notebook-client';

// Listen to remote changes
let notebookListener = rtc.hub(hubName).interval(500).onNotebookChange(
                fileName,
                initialFile,
                (file) => {
                    // This function will be called every 500 ms with the up to date notebook file
                    // You can use this file content to update the UI display
                });

// Report local changes to remote. This local change is the diff between current notebook file version and the previous synced version in onNotebookChange
// Insert text in a notebook cell
notebookListener.insertText(cell, pos, text)

// Remove text from a notebook cell
notebookListener.removeText(cell, pos, text)

// Insert a new notebook cell
notebookListener.insertCell(index, newCell)

// Remove a notebook cell
notebookListener.removeCell(index, oldCell)

// Move a notebook cell to a new position
notebookListener.moveCell(oldIndex, newIndex)
```
Example implementation
https://github.com/yunluyl/realtime-notebook-client-web-example
