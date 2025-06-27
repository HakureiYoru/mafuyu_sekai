import pygame
import sys
import os
import time
from config import font, big_font, WHITE, BLACK, WIDTH, HEIGHT, FPS

import math



# 文件路径
SCORE_FILE = "high_scores.txt"

def resource_path(relative_path):
    """获取打包后的资源路径"""
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)



def format_time(seconds: float) -> str:
    """Format seconds to MM:SS."""
    minutes = int(seconds) // 60
    secs = int(seconds) % 60
    return f"{minutes:02d}:{secs:02d}"


def draw_timer(screen, start_time):
    elapsed = time.time() - start_time
    timer_text = font.render(f"Time: {format_time(elapsed)}", True, WHITE)
    screen.blit(timer_text, (10, 10))
    return elapsed


def game_over_screen(screen, survival_time):
    screen.fill(BLACK)
    over = big_font.render("Game Over!", True, WHITE)
    time_text = font.render(
        f"You survived for {format_time(survival_time)}", True, WHITE
    )

    screen.blit(over, (WIDTH // 2 - over.get_width() // 2, HEIGHT // 2 - 100))
    screen.blit(time_text, (WIDTH // 2 - time_text.get_width() // 2, HEIGHT // 2))
    pygame.display.flip()


def update_high_scores(score):
    """更新排行榜，自动创建文件并仅保留前十名"""
    scores = []

    if os.path.exists(SCORE_FILE):
        try:
            with open(SCORE_FILE, "r") as f:
                scores = [int(line.strip()) for line in f if line.strip()]
        except Exception as e:
            print(f"Error reading high scores: {e}")

    scores.append(score)
    scores.sort(reverse=True)
    top_scores = scores[:10]

    try:
        with open(SCORE_FILE, "w") as f:
            for s in top_scores:
                f.write(f"{s}\n")
        print("High Scores:", top_scores)  # 调试信息
    except Exception as e:
        print(f"Error updating high scores: {e}")


def display_high_scores(screen):
    """Display the top 10 high scores at the beginning of the game"""
    screen.fill(BLACK)

    # Display the title (Centered at the top)
    title = big_font.render("High Scores", True, WHITE)
    screen.blit(title, (WIDTH // 2 - title.get_width() // 2, 50))

    # Display game instructions
    desc_lines = [
        "生存于真冬的世界！",
        "1. 方向键移动",
        "2. 空格键射击",
        "3. 屏幕敌人越多，射击越强",
        "4. 敌人会掉落回复道具并逐渐变强",
        "5. 按 B 键使用炸弹（若拥有）"
    ]

    # Adjust vertical spacing between each line
    line_start_y = 120  # Starting Y position for the first description line
    line_spacing = 35  # Distance between each line

    for idx, line in enumerate(desc_lines):
        line_surface = font.render(line, True, (255, 215, 0))  # Gold-colored text
        screen.blit(line_surface, (WIDTH // 2 - line_surface.get_width() // 2, line_start_y + idx * line_spacing))

    # Adjust the starting position for the high scores list
    scores_start_y = line_start_y + len(desc_lines) * line_spacing + 60  # Increased space after instructions

    # Display high scores
    try:
        with open(SCORE_FILE, "r") as f:
            scores = [int(line.strip()) for line in f.readlines()]
            scores.sort(reverse=True)
    except Exception as e:
        print(f"Error reading high scores: {e}")
        scores = []

    # Adding extra vertical space between the instructions and the scores
    for i, score in enumerate(scores[:10]):
        score_text = font.render(f"{i + 1}. {score}", True, WHITE)
        screen.blit(score_text, (WIDTH // 2 - score_text.get_width() // 2, scores_start_y + i * line_spacing))

    # Display prompt to start the game
    tip = font.render("Press any key to start", True, WHITE)
    screen.blit(tip, (WIDTH // 2 - tip.get_width() // 2, HEIGHT - 80))

    pygame.display.flip()

    # Wait for any key press to start the game
    waiting = True
    clock = pygame.time.Clock()
    while waiting:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.KEYDOWN:
                waiting = False
        clock.tick(FPS)
    pygame.event.clear()
