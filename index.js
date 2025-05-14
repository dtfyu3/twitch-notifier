module.exports = (req, res) => {
  res.status(200).json({ 
    status: "OK",
    message: "Вебхук доступен по /api/webhook" 
  });
};
