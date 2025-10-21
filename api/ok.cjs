module.exports = (req, res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.status(200).end(JSON.stringify({ ok:true, t: Date.now() }));
};
module.exports.config = { runtime: 'nodejs' };
