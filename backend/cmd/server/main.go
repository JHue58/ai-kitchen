package main

import (
	"ai-kitchen/internal/config"
	"ai-kitchen/internal/handler"
	"ai-kitchen/internal/model"
	"ai-kitchen/internal/repository"
	"ai-kitchen/internal/service"
	"context"
	"flag"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	path := flag.String("config", "../config.yaml", "配置文件")
	host := flag.String("host", "", "监听地址")
	port := flag.Int("port", 0, "监听端口")
	admin := flag.String("init-admin", "", "初始化管理员用户名；密码从 KITCHEN_ADMIN_PASSWORD 读取")
	flag.Parse()
	c, e := config.Load(*path)
	if e != nil {
		log.Fatal(e)
	}
	if *host != "" {
		c.Server.Host = *host
	}
	if *port != 0 {
		c.Server.Port = *port
	}
	db, e := repository.Open(c)
	if e != nil {
		log.Fatal("数据库初始化失败：", e)
	}
	if *admin != "" {
		password := os.Getenv("KITCHEN_ADMIN_PASSWORD")
		if len(password) < 10 || len(password) > 72 {
			log.Fatal("KITCHEN_ADMIN_PASSWORD 需为 10–72 字节")
		}
		var n int64
		db.Model(&model.User{}).Where("admin = ?", true).Count(&n)
		if n > 0 {
			log.Fatal("管理员已经存在")
		}
		b, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if e = db.Create(&model.User{Username: *admin, Password: string(b), Admin: true}).Error; e != nil {
			log.Fatal("管理员创建失败")
		}
		log.Print("管理员创建成功")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go service.Worker(ctx, db, c)
	server := &http.Server{Addr: fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port), Handler: (&handler.Server{DB: db, C: c}).Router(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("AI Kitchen: http://%s", server.Addr)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
