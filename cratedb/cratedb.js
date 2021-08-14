/*
   Copyright 2024 Georg Traar

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/ 

module.exports = function (RED) {
    "use strict";
    const axios = require('axios');

    /*
        Query Node
    */

    function CrateDBNode(config) {
        RED.nodes.createNode(this, config);

        this.server = RED.nodes.getNode(config.server);
        this.connection = getConnection(this.server);
        this.query = config.query;

        this.on('input', request);
        this.on('close', function () {
            // tidy up any state
        });
    }

    async function request(msg, send, done) {
        let body = {
            stmt: this.query
        };

        if (msg.payload.hasOwnProperty('stmt')) {
            body.stmt = msg.payload.stmt;
        }
        if (msg.payload.hasOwnProperty('args')) {
            body.args = msg.payload.args;
        }
        if (msg.payload.hasOwnProperty('bulk_args')) {
            body.bulk_args = msg.payload.bulk_args;
        }

        try {
            let res = await axios.post(this.connection.crate_api, body);
            msg.payload = parseResult(res.data, body);
            send(msg);
            this.status({ fill: "green", shape: "ring", text: "success" });

        } catch (err) {
            let http_error;
            try {
                http_error = err.response.data.error;
                done(http_error);
                this.status({ fill: "red", shape: "ring", text: `Error ${http_error.code}` });
            } catch (err2) {
                done(err);
                this.status({ fill: "red", shape: "ring", text: `Error ${err}` });
            }
        }
    }

    function parseResult(data, body) {
        // single statements
        if (data.hasOwnProperty("rows")) {
            data.objects = data.rows.map(row => {
                let obj = {};
                row.map((el, i) => obj[data.cols[i]] = el);
                return obj;
            });
        // bulk statements
        } else if (data.hasOwnProperty("results")) {
            data.objects = data.results.map(row => row["rowcount"]);
        }
        return data;
    }

    RED.nodes.registerType("query", CrateDBNode)


    /*
        Ingest Node
    */

    function CrateDBIngestNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.server = RED.nodes.getNode(config.server);
        this.table = config.table;
        this.mapColumns = config.mapColumns;

        node.connection = getConnection(this.server)

        node.on('input', async function (msg, send, done) {

            // Treat every input as array to use bulk requests later
            const payloadArray = Array.isArray(msg.payload) ? msg.payload : [msg.payload];

            const body = getBulkInsertRequest(node.table, payloadArray, node.mapColumns);

            try {
                const res = await axios.post(node.connection.crate_api, body);
                const errors = [];
                for (let i = 0; i < res.data?.results?.length; i++){
                    if(res.data.results[i] == 1) errors.push(payloadArray[i]);
                }

                msg.records = {
                    total: res.data?.results?.length || 0,
                    errors: errors.length
                }

                msg.payload = errors.length > 0 ? errors : null;
                send(msg);
                done();
            } catch (err) {
                if(err.response?.data) {
                    msg.error = err.response?.data.error;
                    send(msg);
                } else {
                    done(err);
                }
            }
        });

        node.on('close', function () {
            // tidy up any state
        });
    }

    RED.nodes.registerType("ingest", CrateDBIngestNode)

    /*
        Config Node
    */

    function CrateDBClusterNode(config) {
        RED.nodes.createNode(this, config);
        this.host = config.host;
        this.port = config.port;
        this.usetls = config.usetls;
    }
    RED.nodes.registerType("cratedb-cluster", CrateDBClusterNode, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    })
}

function getConnection(server) {
    let protocol = server.usetls ? 'https:' : 'http:';
    let url;

    try {
        url = new URL(server.host);
        // if connection.host doesn't contain protocol e.g. 'crate.io:4200'
        if (!['http:', 'https:'].includes(url.protocol)) {
            url = new URL(protocol + '//' + server.host);
        }
    } catch (error) {
        // Assume the host is just a hostname or hostname with port, no protocol
        url = new URL(protocol + '//' + server.host);
    }

    // Assign port if specified
    if (server.port) {
        url.port = server.port;
    }

    // Initialize connection object with the CrateDB SQL API endpoint
    let connection = {
        crate_api: `${url.href}_sql`
    }

    // Include credentials if provided
    if (server.credentials?.user) {
        connection.config = {
            username: server.credentials.user,
            password: server.credentials.password || undefined
        };
    }

    return connection;
}

function getBulkInsertRequest(table, objectArray, mapColumns) {

    if(!mapColumns) objectArray = objectArray.map(record => ({payload: record}));

    // Extract all distinct properties from the object array using a Set for uniqueness
    const properties = Array.from(objectArray.reduce((acc, obj) => {
        Object.keys(obj).forEach(key => acc.add(key));
        return acc;
    }, new Set()));

    // Create the INSERT statement with placeholders for parameterized queries
    const placeholders = properties.map(() => "?").join(", ");
    const stmt = `INSERT INTO ${table} (${properties.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;

    // Prepare the arguments for the bulk insert
    const bulk_args = getBulkArgs(properties, objectArray);

    return { stmt, bulk_args };
}

function getBulkArgs(properties, objectArray) {
    // Map each object to an array of values corresponding to the properties list
    return objectArray.map(obj => properties.map(prop => obj[prop] === undefined ? null : obj[prop]));
}