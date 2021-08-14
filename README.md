# node-red-contrib-cratedb

node-red-contrib-cratedb is a [**Node-RED**](https://nodered.org/) node designed
to interface with the [**CrateDB**](https://crate.io/) 🐐 through its [**HTTP
endpoint**](https://cratedb.com/docs/crate/reference/en/5.6/interfaces/http.html) (port 4200). There are nodes for general queries and for bulk ingestion.


> [!WARNING]
> This project is currently under development and should not be used in production
> environments. It is not an official CrateDB project and is developed
> independently from Crate.io.


There are two types of nodes:

## Query Node

You can run any kind of query against a CrateDB Cluster. Queries can be configured
in the node configuration or passed in as a message property.

```json
{
    "stmt": "SELECT * FROM my_table WHERE id = ?",
    "args": [1]
}
```

if you want to use bulk args you can pass
    
```json
{
    "stmt": "INSERT INTO my_table (id, name) VALUES (?, ?)",
    "bulk_args": [[1, "Alice"], [2, "Bob"]]
}
 ```

## Ingest Node

Designed for data ingestion, this node accepts `msg.payload` containing the data
to be inserted into a CrateDB table. The payload can be either a single object
or an array of objects.

- Single object:
    ```json
    {
        "id": 1,
        "name": "Alice"
    }
    ```

- Array of objects:
    ```json
    [
        {
            "id": 1,
            "name": "Alice"
        },
        {
            "id": 2,
            "name": "Bob"
        }
    ]
    ```

Data insertion defaults to the table specified in the node configuration, but 
can be overridden with `msg.table`.


### Override Table:

```json
{
    "table": "my_table",
    "payload": {
        "id": 1,
        "name": "Alice"
    }
}
```

### Disable Mapping:

This can be disabled by setting the `msg.map` property to `false` or in the
node settings. In this case the object is inserted into the `payload` column as
a JSON object.

```json
{
    "table": "my_table",
    "map": false,
    "payload": {
        "id": 1,
        "name": "Alice"
    }
}
```

### Schema Preparation:

For direct mapping, ensure your table schema is predefined:

```sql
CREATE TABLE IF NOT EXISTS my_table (
    id INTEGER,
    name STRING,
    ts GENERATED ALWAYS AS CURRENT_TIMESTAMP
);
```

For storing in a single payload column:

```sql
CREATE TABLE IF NOT EXISTS my_table (
    payload OBJECT(DYNAMIC),
    ts GENERATED ALWAYS AS CURRENT_TIMESTAMP
);
```


# Develop

To installsthe node-red-contrib-cratedb node, navigate to your Node-RED installation directory and run:

```
cd ~/.node-red
npm install <path_to_repo>/node-red-contrib-cratedb
```


> [!NOTE] 
> CrateDB and the CrateDB logo are trademarks of Crate.io. All rights reserved.