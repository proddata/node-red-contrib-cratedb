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
    const { CrateDBClient } = require('@proddata/node-cratedb');

    /*
        Query Node
    */

    function CrateDBNode(config) {
        RED.nodes.createNode(this, config);
        this.server = RED.nodes.getNode(config.server);
        this.query = config.query;
        this.client = null;

        if (this.server) {
            this.client = new CrateDBClient({
                host: this.server.host,
                port: this.server.port,
                user: this.server.credentials?.user,
                password: this.server.credentials?.password,
                ssl: this.server.usetls,
                rowMode: 'object'  // Return results as objects instead of arrays
            });
        }

        this.on('input', async function(msg, send, done) {
            if (!this.client) {
                done("No CrateDB connection configured");
                return;
            }

            let query = this.query;
            let args = [];
            let bulk_args = null;

            // Allow query override via msg.payload
            if (msg.payload?.stmt) {
                query = msg.payload.stmt;
            }
            if (msg.payload?.args) {
                args = msg.payload.args;
            }
            if (msg.payload?.bulk_args) {
                bulk_args = msg.payload.bulk_args;
            }

            try {
                let result;
                if (bulk_args) {
                    result = await this.client.executeMany(query, bulk_args);
                } else {
                    result = await this.client.execute(query, args);
                }

                msg.payload = result;
                this.status({fill:"green", shape:"dot", text:"success"});
                send(msg);
                done();
            } catch (err) {
                this.status({fill:"red", shape:"ring", text:err.message});
                done(err);
            }
        });

        this.on('close', function () {
            // tidy up any state
        });
    }

    RED.nodes.registerType("query", CrateDBNode)


    /*
        Ingest Node
    */

    function CrateDBIngestNode(config) {
        RED.nodes.createNode(this, config);
        this.server = RED.nodes.getNode(config.server);
        this.table = config.table;
        this.mapColumns = config.mapColumns;
        this.client = null;

        if (this.server) {
            this.client = new CrateDBClient({
                host: this.server.host,
                port: this.server.port,
                user: this.server.credentials?.user,
                password: this.server.credentials?.password,
                ssl: this.server.usetls
            });
        }

        this.on('input', async function(msg, send, done) {
            if (!this.client) {
                done("No CrateDB connection configured");
                return;
            }

            const table = msg.table || this.table;
            const mapColumns = msg.hasOwnProperty('map') ? msg.map : this.mapColumns;

            try {
                let result;
                if (Array.isArray(msg.payload)) {
                    result = await this.client.insertMany(table, msg.payload);
                } else {
                    result = await this.client.insert(table, msg.payload);
                }

                msg.payload = result;
                this.status({fill:"green", shape:"dot", text:"success"});
                send(msg);
                done();
            } catch (err) {
                this.status({fill:"red", shape:"ring", text:err.message});
                done(err);
            }
        });

        this.on('close', function () {
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