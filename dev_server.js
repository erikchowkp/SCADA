const express = require("express");
const path = require("path");

const app = express();
const port = 3001;

app.use(express.json());
app.use(express.static(__dirname)); // serve static files including IO_config.html

// Mount the dev API
const devApi = require("./dev_api");
app.use("/api/dev", devApi);

app.listen(port, () => {
    console.log(`🛠️  Development server running at http://localhost:${port}`);
    console.log(`📝 Access I/O Configuration at: http://localhost:${port}/IO_config.html`);
    console.log(`⚠️  Main SCADA server (port 3000) must be STOPPED to save changes`);
});
