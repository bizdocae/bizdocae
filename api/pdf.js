import handler from "./download-get.js";
export default async (req, res) => {
  req.query = { ...(req.query||{}), type: "pdf" };
  return handler(req, res);
};
