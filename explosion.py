import pygame
import random
from config import RED, ORANGE, YELLOW, GREEN, BLUE

class Explosion:
    def __init__(self, x, y, explosion_type=None):
        self.x = x
        self.y = y
        self.radius = 1
        self.max_radius = 30  # 最大半径
        self.lifetime = 10  # 帧数寿命
        self.particles = []  # 存储爆炸粒子
        self.explosion_type = explosion_type  # 存储爆炸类型

    def update(self):
        # 增加半径和减少生命周期
        self.radius += 3
        self.lifetime -= 1

        # 生成粒子效果
        if self.lifetime % 2 == 0:  # 每隔两帧产生一个粒子
            self.particles.append(ExplosionParticle(self.x, self.y, self.explosion_type))

        # 更新所有粒子
        for particle in self.particles:
            particle.update()

    def draw(self, screen):
        if self.lifetime > 0:
            # 渐变颜色效果：根据爆炸类型改变颜色
            if self.explosion_type == "player":
                color = RED
            elif self.explosion_type == "enemy":
                color = GREEN
            elif self.explosion_type == "big":
                color = BLUE
            else:
                # 默认颜色：从红色到橙色，再到黄色
                if self.lifetime > 7:
                    color = RED
                elif self.lifetime > 4:
                    color = ORANGE
                else:
                    color = YELLOW

            # 画爆炸的圆形
            pygame.draw.circle(screen, color, (int(self.x), int(self.y)), self.radius, 2)

            # 画粒子效果
            for particle in self.particles:
                particle.draw(screen)

    def is_finished(self):
        return self.lifetime <= 0


class ExplosionParticle:
    def __init__(self, x, y, explosion_type=None):
        self.x = x
        self.y = y
        self.size = random.randint(2, 4)  # 粒子的初始大小
        self.vx = random.uniform(-2, 2)  # 粒子的水平速度
        self.vy = random.uniform(-2, 2)  # 粒子的垂直速度
        self.lifetime = random.randint(5, 10)  # 粒子生命周期
        self.explosion_type = explosion_type

    def update(self):
        self.x += self.vx
        self.y += self.vy
        self.lifetime -= 1

    def draw(self, screen):
        if self.lifetime > 0:
            # 根据爆炸类型调整粒子的颜色
            if self.explosion_type == "player":
                color = RED
            elif self.explosion_type == "enemy":
                color = GREEN
            elif self.explosion_type == "big":
                color = BLUE
            else:
                color = YELLOW  # 默认颜色

            pygame.draw.circle(screen, color, (int(self.x), int(self.y)), self.size)
