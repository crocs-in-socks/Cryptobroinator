import express from "express"
import cors from "cors"
import airtable from "airtable"
import axios from "axios"
import dotenv from "dotenv"

dotenv.config()

const app = express()
const port = process.env.PORT || 8000
app.use(cors())
app.use(express.json())

const base = new airtable({apiKey: process.env.AIRTABLE_API_KEY}).base(process.env.BASE_ID)
const tableName = "coins"

const cache = {}

setInterval(async() => {
    const top20 = await fetchTop20()
    await updateDetailsInTable(top20.slice(0, 10))
    await updateDetailsInTable(top20.slice(10, 20))
}, 10 * 60 * 1000)

setInterval(fetchAndUpdate, 60 * 1000)

app.listen(port, () => {
    console.log(`Server is listening on port : ${port}`)
})

app.get("/coins", async (req, res) => {
    try
    {
        const records = await base(tableName).select().all()
        const coins = records.map((record) => record.fields)
        res.json(coins)
    }
    catch(e)
    {
        res.status(500).json({
            error: "Internal server error"
        })
    }
})

app.get("/coins/price/:id", (req, res) => {
    const { id } = req.params

    if(cache[id])
    {
        res.json({ id, price: cache[id]})
    }
    else
    {
        base(tableName).select({
            filterByFormula: `id = '${id}'`,
            fields: ['currentprice'],
            maxRecords: 1,
        }).firstPage((err, records) => {
            if(err)
            {
                console.error("Error fetching coin price from airtable", res.status(500).json({error: "Internal Server Error"}))
            }
            else if(records && records.length > 0)
            {
                const price = records[0].get("currentprice")
                cache[id] = price
                res.json({id, price})
            }
            else
            {
                res.status(404).json({error: "Coin not found"})
            }
        })
    }
})

async function fetchAndUpdate()
{
    const records = await base(tableName).select({
        "fields": ["id"],
        "maxRecords": 10
    }).all()

    const ids = records.map((record) => record.get("id"))

    try
    {
        const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
            params: {
                "ids": ids.join(","),
                "vs_currencies": "usd",
            }
        })

        for(const id in response.data)
        {
            const price = response.data[id].usd
            cache[id] = price

            await base(tableName).update([
                {
                    "id": records.find((record) => record.get("id") === id).id,
                    "fields": { "currentprice": price}
                }
                
            ])
        }

        console.log("Updated coin prices : ", response.data)
    }
    catch (e)
    {
        console.error("Error fetching and updating coin prices : ", e.message)
    }
}

async function updateDetailsInTable(coins)
{
    const records = coins.map((coin) => ({
        "fields": {
            "id": coin.id,
            "name": coin.name,
            "symbol": coin.symbol,
            "market_cap": coin.market_cap,
        },
    }))

    try
    {
        const updatedRecords = await base(tableName).create(records)
        console.log("Updated coin details in airtable : ", updatedRecords)
    }
    catch(e)
    {
        console.error("Error updating coin details in airtable : ", e.message)
    }
}

async function fetchTop20()
{
    try
    {
        const response = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
            params: {
                vs_currency: "usd",
                order: "market_cap_desc",
                per_page: 20,
                page: 1,
            },
        })

        return response.data
    }
    catch(e)
    {
        console.error("Error fetching the top 20 coions : ", e.messsage)
    }
}

async function fetchCoinList()
{
    try
    {
        const response = await axios.get("https://api.coingecko.com/api/v3/coins/list?include_platform=false")
        return response.data
    }
    catch(e)
    {
        console.error("Error fetching coin list : ", e.message)
    }
}
