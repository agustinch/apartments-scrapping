import express from "express";
import scrapeIt from "scrape-it";
import nodemailer from "nodemailer";
import { Client } from "pg";
import format from "pg-format";

require("dotenv").config();

const connectionString = process.env.CONNECT_URI;
const client = new Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});
client.connect();

const port = Number(process.env.PORT) || 3000;

const app = express();

interface ScrapResult {
  title: string;
  price: string;
  link: string;
  id: string;
}

const scrapping = (url: string): Promise<any> => {
  const list =
    ".clearfix > div > :nth-child(2) > div > .col-9 > :nth-child(3) > .flex-wrap > .col-12";
  return scrapeIt(url, {
    deptos: {
      listItem: `${list}`,
      data: {
        title: `.col-7 > .flex-auto > a > div`,
        link: { selector: ".col-7 > .flex-auto > a", attr: "href" },
        price: ".col-7 > .flex-auto > .py1 > div > p",
        id: {
          selector: ".col-5 > amp-state",
          attr: "id",
          how: "string",
          convert: (x) => x.replace("selected_", ""),
        },
      },
    },
  }).then(({ data, response }) => {
    return data;
  });
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.USER_EMAIL, // generated ethereal user
    pass: process.env.USER_PASSWORD, // generated ethereal password
  },
});

const main = async () => {
  console.log("Running...");
  const result = await Promise.all([
    scrapping(
      "https://clasificados.lavoz.com.ar/inmuebles/todo?list=true&cantidad-de-dormitorios%5B0%5D=1-dormitorio&operacion=alquileres&provincia=cordoba&ciudad=cordoba&barrio%5B0%5D=general-paz&page=1"
    ),
    scrapping(
      "https://clasificados.lavoz.com.ar/inmuebles/todo?list=true&cantidad-de-dormitorios%5B0%5D=1-dormitorio&operacion=alquileres&provincia=cordoba&ciudad=cordoba&barrio=nueva-cordoba"
    ),
    scrapping(
      "https://clasificados.lavoz.com.ar/inmuebles/todo?list=true&cantidad-de-dormitorios%5B0%5D=1-dormitorio&operacion=alquileres&provincia=cordoba&ciudad=cordoba&barrio=centro"
    ),
  ]);

  const deptosSaved = await client.query("SELECT id from deptos");
  const deptosId = deptosSaved.rows.flatMap((r) => r.id);
  const deptos: ScrapResult[] = result
    .flatMap((o) => o.deptos)
    .filter((o) => o.id && !deptosId.includes(o.id));

  if (deptos.length === 0) {
    console.log("Nada nuevo.");
    return;
  }

  const deptosToInsert = deptos.map((d) => [d.id, d.title, d.link]);

  await client.query(
    format("INSERT INTO deptos (id, name, url) VALUES %L", deptosToInsert)
  );

  const deptosList =
    "<div>" +
    deptos
      .map((d) => {
        return `<a href="${d.link}">${d.title}</a><br/><div>${d.price}</div>`;
      })
      .join("") +
    "</div>";

  await transporter.sendMail({
    from: "Agu Bot", // sender address
    to: process.env.EMAIL_TO, // list of receivers
    subject: `${deptos.length} depto/s encontrado/s`, // Subject line
    html: deptosList, // html body
  });
  console.log(`${deptos.length} deptos encontrados`);
};

setInterval(() => main(), 10000);

app.get("/", (req, res) => {});

app.listen(port, () => {
  console.log(`Server running`);
});
